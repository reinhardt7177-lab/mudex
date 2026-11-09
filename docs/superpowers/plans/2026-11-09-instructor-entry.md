# Instructor entry correction

Problem: the original cloud gate accepted only learner MDX codes and omitted the instructor entry expected by the user. User supplied an instructor credential and explicitly approved changing the existing relay administrator credential to it after its authentication failed.

Approach: keep the existing learner workspace authentication, add a separate instructor form and management page using the relay's existing admin list/create/disable APIs. Encrypt the supplied credential in a short-lived HttpOnly cookie; no plaintext credentials in source or local storage. Only update the existing mudex admin credential hash in Supabase; preserve codes and user workspaces.

- [x] Test and implement encrypted instructor sessions, authenticated admin proxy and validation.
- [x] Add explicit role navigation and instructor form, code listing/issuance/disable and workspace entry.
- [x] Apply the user-authorized credential hash change and confirm existing code count is unchanged (6).
- [x] Review, deploy, verify real instructor login and desktop/mobile screens, update source PR.

Verification: 14 automated tests pass. Live instructor authentication and code list both return HTTP 200, with all existing 6 codes retained. Desktop and mobile (390px, no document overflow) instructor management reviewed. Review findings fixed: uploaded active content is sandboxed/download-only at the edge; exhausted codes are excluded from distribution.

Do not issue/disable real learner codes or run paid model generation as part of verification.
