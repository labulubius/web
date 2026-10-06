# Interface Design and Change-Scope Standard

This document is the source of truth for visual, interaction, accessibility, permission, and change-scope decisions in the Labulubius workspace. Read it before planning or implementing any user-interface change.

The goal is not to make every page identical. The goal is to make every feature feel like part of the same KDE Breeze-inspired application while preserving each route's functional needs and preventing unrelated changes.

## 1. Decision hierarchy

When design signals conflict, use this order:

1. This document.
2. Existing shared components and CSS variables.
3. The approved reference page or pages for the task.
4. The target page's current behavior and data contract.
5. A new design decision documented in the task.

Do not replace the existing visual language merely because another pattern is newer or more fashionable.

## 2. Reference-page matrix

Reference pages are read-only examples unless the task explicitly includes them. Studying a page does not grant permission to modify it.

| Need | Primary reference | Reuse or align with |
| --- | --- | --- |
| Global navigation, theme, window frame and status bar | `SiteShell` | Toolbar navigation, active state, sidebar controls, theme control, application viewport and status bar |
| Categories, search, cards, favorites, drag sorting and edit dialogs | `/nav` | Sidebar category rows, search field, card density, action placement and `AccessibleDialog` forms |
| Private file browsing and owner-only access | `/drive` | Page header, action buttons, breadcrumbs, tabular rows, empty state, progress, error and destructive confirmation |
| Public-link file management | `/drive` | Drive link actions, file-only capability semantics and direct public downloads |
| Source navigation, item streams, filters and dense settings | `/feeds` | Sidebar hierarchy, selected rows, article list, settings tables, automatic loading and partial-error handling |
| Accessible modal behavior | `AccessibleDialog` | Focus entry and restoration, focus trapping, Escape/backdrop handling, busy state and labelled dialogs |
| Signed-out owner-only page | `OwnerAccess` | Consistent explanation and sign-in guidance |

Example: a `/feeds` redesign may inspect `/nav` and `/drive`, but the approved file scope remains `/feeds` unless shared or reference-page changes are separately approved.

## 3. Required scope contract

Before editing, state the following in the task plan:

```text
Target route or component:
Requested behavior:
Allowed files or directories:
Explicitly excluded routes:
Shared files required:
API, persistence or permission changes:
Reference pages:
```

Default scope rules:

- Modify only the target route, its route-owned components, its route-owned stylesheet, and directly relevant tests or documentation.
- Do not make drive-by fixes or visual cleanups outside the declared scope.
- Do not change reference pages merely to make the target easier to copy.
- Do not change APIs, persistence, sorting, pagination, caching, URLs, authentication, authorization, CORS, CSP, or data exposure during a visual-only task.
- Report unrelated problems instead of fixing them.
- Treat every file outside the declared allowlist as out of scope.

For a route such as `/feeds`, the normal allowlist is `app/feeds/**`, route-specific tests, and the task's documentation. Files such as `app/nav/**`, `app/drive/**`, `app/globals.css`, `app/site-shell.tsx`, `app/site-auth.tsx`, and server/API modules are excluded unless explicitly approved.

## 4. Shared-change approval gate

The following are shared surfaces and require approval before modification:

- `app/globals.css`
- `app/site-shell.tsx`
- `app/accessible-dialog.tsx`
- `app/site-auth.tsx`
- `app/owner-access.tsx`
- global layout, navigation, theme, font, CSP, or manifest files
- reusable API, authentication, storage, upload, or persistence modules
- any component or selector used by another route

Before requesting approval, explain:

1. Why the target route cannot solve the requirement locally.
2. Which routes and states can change.
3. The exact shared files and selectors involved.
4. The expected visual, behavioral, security, and accessibility effects.
5. The regression checks that will be run on every affected route.

Do not edit the shared surface until approval is explicit. If approval is denied, keep the solution route-local or reduce the requested scope.

## 5. Shared application skeleton

Workspace routes use `SiteShell` rather than inventing another application frame. Preserve:

- the full-viewport Breeze window;
- the 48 px global toolbar;
- main navigation and active-route indication;
- theme and account controls;
- the scrollable application viewport;
- the 24 px status bar;
- per-page sidebar collapse state;
- mobile sidebar toggle, backdrop, and Escape behavior.

Routes with category, source, folder, or filter navigation should use `hasSidebar` and provide an `aside` with `id="page-sidebar"` and an accurate accessible label.

The shared skeleton may be reused. Functional content may differ: cards for a directory, rows for files, and items for Feeds are all valid when their surrounding hierarchy remains consistent.

## 6. Existing visual foundation

### Typography and icons

- Use the existing Noto Sans and Noto Sans Mono font variables.
- Use Lucide icons already present in the project before introducing another icon source.
- Match the existing semantic icon: Plus for creation, Pencil for editing, Trash for deletion, Folder/FolderOpen for hierarchy, Refresh for reload, and X for closing.
- Do not use emoji as interface icons.
- Icon-only buttons require both an accessible name and a visible tooltip through `title` when useful.

### Color tokens

Use existing variables instead of adding route-local literal colors:

- surfaces: `--window`, `--window-alt`, `--view`, `--view-alt`, `--button`, `--header`;
- text: `--text`, `--text-muted`, `--link`;
- emphasis: `--accent`, `--accent-soft`;
- status: `--negative`, `--neutral`, `--positive`;
- structure: `--frame`, `--separator`.

Light and dark themes are already defined by the shared shell. Any new state must work in explicit light, explicit dark, and system theme modes.

### Shape, spacing and density

Follow existing values before creating new ones:

- normal controls and cards use approximately 4 px radii;
- list containers use approximately 5 px radii;
- dialogs use a 6 px radius;
- standard bordered action buttons use `var(--button)`, `var(--frame)`, a 4 px radius, and approximately `7px 10px` padding;
- category/source sidebars use the shared `--sidebar-width` of 220 px and approximately `13px 8px` padding;
- sidebar/content layouts use `minmax(0, 1fr)` to prevent overflow;
- directory/feed content commonly uses 22 px padding;
- centered file-management views use a maximum width around 1080 px and `36px 28px` desktop padding;
- separators use `1px solid var(--separator)`.

These are current alignment targets, not permission to change shared CSS. A global token or measurement change requires the shared-change approval gate.

## 7. Layout and component patterns

### Sidebars

- Keep heading, category, source, checkbox, selected, collapsed, and row-action behavior consistent with `/nav` and `/feeds`.
- Do not expose administrator mutation controls to non-admin users.
- Truncate long labels without making the full value inaccessible; use a title or equivalent when needed.
- Preserve the shared collapsed and mobile overlay behavior.

### Page headings and tools

- Use the existing section label, title, description, divider, and right-aligned action pattern.
- Keep primary actions visually distinct but not oversized.
- Place creation actions in the heading or the established sidebar heading, not in arbitrary floating controls.
- On narrow screens, allow heading actions to wrap or stack without horizontal scrolling.

### Lists, cards and tables

- Choose the representation that fits the data rather than forcing every page into cards.
- Use separators and subtle hover states instead of heavy shadows.
- Keep row action controls grouped at the trailing edge.
- Do not make an entire row both a drag surface and an activation link without an established conflict-prevention pattern.
- Preserve stable row heights and avoid layout shifts while loading or saving.

### Dialogs and forms

- Use `AccessibleDialog` for modal forms.
- Provide an `aria-labelledby` heading, labelled inputs, Cancel and primary submit actions, and a disabled/busy state.
- Prevent closing a busy dialog when doing so could leave an ambiguous operation.
- Use the existing `.form-error` pattern with `role="alert"`.
- Do not create an unrelated modal implementation inside a route.

### Destructive actions

- Use the existing negative color and Trash icon semantics.
- Ask for confirmation before irreversible deletion or link revocation.
- State the affected object and consequence, including recursive deletion or public-link revocation.
- Do not rely on red color alone to communicate danger.

## 8. Required page states

Every data-driven UI must deliberately handle applicable states:

1. Initial account or application check.
2. Initial data loading.
3. Loaded content.
4. Empty collection.
5. Filter or search with no matches.
6. Partial provider failure while other data remains usable.
7. Complete load failure with a retry path when retry is possible.
8. Signed-out or non-admin access.
9. Expired session.
10. Saving, uploading, deleting, or refreshing.
11. Successful mutation feedback.
12. Failed mutation feedback.
13. Pagination, continuation, or end-of-results.

Use `role="status"` for nonurgent progress and success updates. Use `role="alert"` for errors that need immediate attention. Empty states should explain what happened and, for administrators, the next available action. Do not leave a blank region as the only state indication.

## 9. Permissions and security boundaries

UI state is not an authorization boundary.

- Continue to verify Supabase bearer tokens and administrator roles in every management API.
- Preserve the distinction between public reads and administrator writes.
- Return only the minimum public data needed by the feature.
- Never move server credentials, internal paths, feed secrets, cookies, authorization headers, or sensitive response bodies into client code, UI messages, logs, or documentation.
- Do not broaden CORS origins, CSP directives, accepted hostnames, remote URL rules, or network access during a UI task.
- Do not change persistent data roots, quotas, deletion semantics, or retention rules as a design side effect.
- Signed-out, non-admin, and administrator experiences must be reviewed separately when the route supports them.
- Hiding or disabling a button never replaces API authorization.

## 10. Responsive requirements

Default validation widths must cover:

- a wide desktop;
- a typical laptop;
- the shared 760 px navigation/sidebar transition;
- phone layouts around and below 650 px where file views change density.

Also test long titles, long source names, empty results, populated results, and visible errors.

On mobile:

- sidebars must use the shared toggle and overlay behavior;
- content must not be hidden under the sidebar or controls;
- toolbar actions may wrap or collapse without losing accessible names;
- dialogs must fit within the dynamic viewport;
- tables and lists must deliberately hide, wrap, or scroll secondary columns;
- touch targets must remain usable;
- nested scroll regions and horizontal overflow must be avoided unless the data requires them.

## 11. Accessibility requirements

- All actions must be reachable and operable by keyboard.
- Focus indicators must remain visible.
- Use native buttons and links according to behavior; do not simulate them with generic elements.
- Dialogs must trap focus, support Escape when safe, and restore focus after closing.
- Icon-only controls require `aria-label`.
- Selected navigation uses `aria-current`; disclosure controls use `aria-expanded`; controlled sidebars use `aria-controls`.
- Form labels must be programmatically associated with inputs.
- Dynamic status and error messages need appropriate live semantics.
- Color cannot be the only state indicator.
- New animation must respect `prefers-reduced-motion`; the shared stylesheet already disables animation and transitions for that preference.
- Preserve readable contrast in light, dark, and system modes.

## 12. Implementation workflow

All work uses the VM100 checkout at `/home/debian/labulubius` through `ssh web`.

1. Record the baseline Git revision and clean status.
2. Declare the scope contract and file allowlist.
3. Read the target route, its stylesheet, shared shell, and approved reference pages.
4. Identify reusable components and tokens before writing new CSS.
5. If a shared file is required, stop and request approval.
6. Implement only within the approved scope.
7. Review `git diff --name-only` and `git diff --check`.
8. Stop if the diff includes an unapproved path.
9. Run lint, type checking, regression tests, and a production build.
10. Complete route-specific desktop, mobile, keyboard, accessibility, permission, and state checks.
11. Commit and push the verified change, deploy it, and run health checks.

A passing build does not prove visual consistency or permission correctness; both require explicit review.

## 13. Required acceptance report

Use this structure when completing a UI task:

```text
Target route:
Approved scope:
Files changed:
Reference pages inspected:
Existing components/tokens reused:
Shared files changed: none | approved list
Other routes changed visually or behaviorally: none | approved list

States checked:
- loading
- populated
- empty/no results
- partial/complete error
- signed-out/non-admin/admin
- saving/destructive action

Responsive checks:
- desktop
- laptop
- <= 760 px
- <= 650 px when applicable

Accessibility checks:
- keyboard navigation
- focus visibility/order
- dialog focus and Escape
- accessible names and labels
- status/error announcements
- light/dark/system contrast
- reduced motion

Security and data-contract changes: none | explicit list
Automated verification:
- lint
- typecheck
- tests
- build
Manual checks not performed:
```

Do not report an unchecked item as passing. State limitations explicitly.

## 14. Exceptions

A task may intentionally depart from this standard only when the user approves the exception. Record the reason, affected routes, shared impact, accessibility impact, and follow-up work in the task before implementation.
