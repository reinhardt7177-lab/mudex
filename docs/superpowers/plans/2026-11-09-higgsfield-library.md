# Higgsfield video library implementation plan

**Goal:** Browse existing Higgsfield videos visually, preview and select them, and import into the current editing job.

**Design:** Reuse the authenticated Higgsfield MCP client. Add a composer button opening a two-pane library: paginated generation/upload list with checkboxes, and a player with prompt/model/date details. On mobile stack the player above the list. Keep the existing dark palette and typography; use violet for selection, no decorative panels. The user explicitly requested the browse/select/import flow; remaining layout choices are implementation decisions.

**Approach:** A dedicated read-only gallery API is simpler and more reliable than making users invoke generic MCP JSON forms or asking the model to assemble a visual list. `show_generations(type:video, only_completed:true)` and `show_medias(type:video)` supply one page at a time. Server-side opaque, expiring selection keys bind downloads to authenticated catalog results; never accept client-provided URLs. Reuse the existing hardened media downloader. No new dependencies or paid generation.

## Tasks
- [x] Write regression tests for normalized provider media envelopes, paginated read-only catalog calls, invalid/expired selection and login changes.
- [x] Add catalog class and import endpoint; guard active/deleted/recreated jobs and serialize downloads with existing busy request tracking.
- [x] Add accessible responsive dialog, loading/login/empty/error/retry states, pagination, preview, multi-selection and import progress. Preserve selection across pages and reject stale job context.
- [x] Run full tests, browser functional checks and desktop/mobile screenshot review; review diff.
- [x] Build a new container tag, deploy the Worker/assets and verify production login/library entry and safe update flow. Commit/push to existing feature branch.

## QA inventory
Open/close/focus/Escape; both sources; preview; selection count; load more/empty pages; refresh/error/retry; selected media import; failed item retry; job switch; expired/login-invalidated selections; desktop 1440x1000 and mobile390x844 fit; logged-out production API. Real account catalog depends on the user's OAuth session; use representative provider fixtures for automated integration checks and state that limit.

## Ledger
- Existing branch `feat/cloudflare`, clean at `322256d`. Existing server advertises `cloud-v4`; bump to `cloud-v5` so old running instances expose the update action.
- Provider metadata verified from connected tool definitions and stored full MCP schemas. Normalized video results use `results.rawUrl`; existing importer does not yet recognize that field, so cover and fix it.
- User reported repeated session rejection after re-login. Official Higgsfield issue #114 (opened2026-11-08, still open2026-11-09) reports identical fresh-DCR-token problem. Added real read-only connection verification after OAuth and separate provider auth diagnostic, without claiming the external issue is fixed.
- 49/49 tests passed; browser representative-data checks passed for desktop/mobile, playback, two-item import requests, zero cursor, uploads tab, failure selection retention, stale-job rejection and authentication recovery. Actual account authorization remains unverified.
- Independent review caught successful user prompt text falsely matching provider error; added failing regression, restricted detection to error fields, regression green. No remaining P1/P2 findings.
- Deployed image `cloud-v7`, digest `sha256:0a42b3c2dde0f9c7fed6ac3fd45fac170a7a779060e65def7689bb1491f5b0d4`; Worker version `0eeee33c-b636-4642-8376-4ea21c601b7c`. Cloudflare rollout completed at target version6. Isolated production workspace advertises `cloud-v5`; library endpoint correctly requests login (400) when unauthenticated to Higgsfield. Production dialog and connection-check/direct-upload controls confirmed. Only the synthetic workspace was restarted.
