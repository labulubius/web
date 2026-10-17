# Shared toolbar alignment acceptance

Target route: shared SiteShell toolbar on Home, Navigator, Feeds, About, and the Agent connection gate. The independent Agent iframe is not redesigned.
Approved scope: normalize toolbar icons and control alignment only. The owner approved changes to the three shared files before implementation. Directly related regression tests and this acceptance record are included.
Files changed: `app/site-shell.tsx`, `app/site-auth.tsx`, `app/globals.css`, `tests/toolbar.test.mjs`, `tests/toolbar-acceptance.md`.
Reference pages inspected: SiteShell, Home, Navigator, Feeds, About, and Agent connection states; reference route implementations remain unchanged.
Existing components/tokens reused: Lucide icons with the default stroke, existing navigation and AccountControl, AccessibleDialog without modifications, and existing Breeze color tokens.
Shared files changed: the three approved files above, limited to toolbar icon sizes, accessible account button names/tooltips, and toolbar CSS selectors.
Other routes changed visually or behaviorally: only the approved shared toolbar surface; route contents and the independent Agent UI are unchanged.

## Scope and behavior

- All toolbar SVG icons use 18 px and retain Lucide stroke width 2; flex shrinking cannot distort icons.
- Desktop sidebar contents align with navigation while keeping the existing 47 px sidebar control footprint. The original toolbar min-height token remains 48 px; the existing rendered 56 px desktop toolbar on sidebar routes and 43 px mobile toolbar are preserved. No-sidebar toolbar sizing is not forced to 56 px.
- Desktop account/theme controls are both 32 px tall with 6 px icon/text gaps.
- Mobile sidebar/navigation controls are 43 by 34 px; account/theme controls are 34 by 34 px. All visible mobile icons share the same vertical center.
- Mobile signed-in accounts show only the User icon, hiding the redundant trailing LogOut icon. The existing button still signs out; its accessible name and tooltip remain available.
- Left stacked labels, right horizontal controls, colors, route order, active states, sidebar persistence, theme cycling and authentication handlers are preserved.

## States checked

- Initial account loading, signed-out, Owner, read-only, account rechecking and account error: real AccountControl rendered with synthetic in-memory contexts in the committed tests (no Supabase requests).
- Loading, Owner, read-only and account-error layouts additionally checked as real SSR AccountControl markup with production CSS at all seven viewport widths. These are synthetic layout fixtures, not real authenticated sessions.
- Signed-out application loading and loaded routes: production-build Chromium checks.
- Empty/no-results, route-content partial/complete errors and saving/destructive operations: not exercised end to end; their implementations and styles are unchanged and out of scope.
- No real login, logout, owner mutations or permission-changing requests were performed.

## Responsive checks

An isolated candidate production server on VM100 passed 84 route/width/theme combinations: Home, Navigator, Feeds and About at 1440, 1280, 761, 760, 650, 390 and 320 px in light, dark and system theme modes. Checks assert icon dimensions/strokes/center alignment, control dimensions, preserved toolbar height, navigation order/current state, accessible names/tooltips, visible keyboard focus, Tab order and absence of document overflow. Another 28 synthetic account-state layout checks passed. Light/dark desktop/mobile screenshots were visually reviewed.

## Accessibility checks

- Native navigation and account controls remain keyboard reachable; Tab order and visible outline checked.
- Enter activates the login dialog; focus enters the dialog; Escape closes it. Desktop sidebar toggle and mobile sidebar/Escape behavior checked.
- Account icon-only controls now have explicit accessible names and useful tooltips; theme and sidebar labels remain present.
- Existing Breeze colors are unchanged; light/dark screenshots reviewed. Formal contrast measurement, screen-reader testing, real phone testing and a complete system-color-scheme switching audit were not performed.
- Reduced-motion preference was emulated during browser checks; no new motion was introduced.
- **Known pre-existing limitation, not fixed:** login dialog focus restoration falls back to BODY after Escape rather than returning to the account button. An isolated browser reproduction using the actual React AccountControl/AccessibleDialog compared baseline `c8416ef` and the candidate: both enter the dialog and both exhibit the same close-focus result. The dialog implementation and its autofocus behavior are unchanged. This is explicitly not a passing focus-restoration check and requires separate shared-component approval if addressed.
- Status/error announcement behavior is unchanged; synthetic account error rendering is covered, not a screen-reader announcement audit.

## Security and data contract

None. APIs, authentication/authorization logic, storage, persistence, CSP, CORS, URLs, cache rules, data exposure and mutation handlers are unchanged. Browser fixtures do not contact Supabase or authenticate a user.

## Automated verification

- Git path allowlist and `git diff --check`: passed before validation.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 116 passed, zero failed/skipped, including eight new toolbar regression tests and isolated WebDAV integration tests.
- `npm run build`: passed.
- VM100 candidate Chromium: 84 route/width/theme checks, 28 synthetic account layouts, keyboard/dialog/theme/sidebar checks and unchanged Agent iframe destination passed, with the existing focus-restoration limitation recorded separately above.

Deployment gates (commit/push, service restart, public HTML cache purge, health/cache-boundary checks, production browser smoke and GitHub Actions) are verified separately after this report is committed; they must not be inferred from the build checks.
