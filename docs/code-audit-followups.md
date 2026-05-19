# Code Audit Follow-Ups

Last updated: 2026-05-19

## Removed in this pass

- Removed unreferenced static site JavaScript assets:
  - `apps/site/js/app-index-2.js` through `apps/site/js/app-index-6.js`
  - `apps/site/js/app-logs-1.js` through `apps/site/js/app-logs-3.js`
  - `apps/site/js/blog-index-2.js`
  - `apps/site/js/index-3.js`
  - `apps/site/js/index-4.js`
  - `apps/site/js/pitchdeck-1.js`
  - `apps/site/js/vp-admin-1.js`
  - `apps/site/js/vp-admin-2.js`
- Replaced public demo links to the retired `/app/logs` surface with `/app/activity`.
- Updated public copy that referenced a separate audit-log surface to refer to activity logs or access evidence.

## Go Back Later

- Decide whether `/app/logs` should remain as a backwards-compatible redirect to `/app/activity`, or whether the route should be removed after external links age out.
- Consolidate versioned static scripts that are still loaded together on some pages, such as `app-keys-1/2/3`, `app-scanner-1/2/3`, and the public marketing page script stacks. They appear to be split by responsibility today, but the naming makes ownership unclear.
- Decide whether old planning docs under `docs/plans/` should be preserved as historical records or moved to an archive folder so current search results stay cleaner.
- Review enterprise-only audit surfaces separately before removing anything. The public dashboard audit surface was removed, but enterprise control-plane routes and exports still reference audit evidence.
- Consider adding a tiny CI check that fails when `apps/site/js/*.js` has no references from HTML, static enterprise templates, or server-rendered route strings.
