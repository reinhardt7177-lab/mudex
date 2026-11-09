# Workspace controls and PC folder access

User requests: job rename/delete controls, usable direct PC-folder connection, and a clear answer/indicator for saving. Later capability question does not cancel this work: report current video tools honestly, including absent Flow computer control and absent Higgsfield gallery import.

Design: rename the display name while keeping stable job IDs. Delete a confirmed idle job and its cloud copies; reject running/uploading jobs and missing jobs. Browser File System Access API connects a user-selected PC folder on supported desktop browsers. It lists media for explicit import; processing still uploads selected files to cloud. Explicit PC save writes conversation metadata and media into a dedicated per-job export directory, not arbitrary original paths. Remember directory handles per workspace/job in IndexedDB and re-request permission only from user clicks. Other browsers retain normal file upload and conversation download. Show cloud save status/time and errors.

- [x] Add/test job management API and storage deletion serialization, restore regression.
- [x] Add/test browser folder helpers, readable conversation export and scoped handle persistence.
- [x] Add visible job actions, cloud save status, folder import/save and transcript download; desktop/mobile QA.
- [x] Review, build/deploy updated Node image and Worker without interrupting active video jobs; verify synthetic cloud workspace; update existing source PR.

Expanded scope approved by user: all connected MCP tools available through discovery/call, with exact one-use approval for effects. Added MCP bridge and authenticated existing Higgsfield media import. No new plugins/services or real paid remote operations.

Verification: 38 tests; native browser OPFS handles exercise real directory/file streams (chooser stubbed to a synthetic directory), import/export, remembered handles, transcript download, wrong-job picker rejection, mobile 390px fit, cross-tab deletion, PC backup retention. Cloud synthetic namespace verified 185 practice tools, approval required and token replay rejection, rename/nested upload, cold restart identity/name/file retention, and PC export from cloud. Security review findings fixed: explicit-negative and multiplex MCP policy, no automatic effect replay, .part imports, workspace+job-UUID PC destination, and async context/SSE guards.

No real user jobs are deleted or renamed in QA. No paid model/media generation. Verify final app version after container image rollout. Existing instructor credential remains unchanged.
