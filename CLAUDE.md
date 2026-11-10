# Outreach

Read `SPEC-2.md` first (it is the build spec; the layout section calls it SPEC.md).

Phase we're on: all six phases are built (skeleton, company page + copies, batching + sending, follow-ups + inbox, dashboard + calendar, polish). Next step is the one-time setup in `README.md` and a real test run in test mode.

- `apps-script/` is the back end (push with `clasp`). `web/` is the Vite + React front end.
- Every colour lives in `web/src/styles/tokens.css`. Nothing else may hard-code one.
- `web/src/api.ts` is the only file that talks to Apps Script.
- Do not add features that are not in the spec without asking.
