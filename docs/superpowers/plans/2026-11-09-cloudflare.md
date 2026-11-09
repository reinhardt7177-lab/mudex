# Mudex Cloudflare Implementation Plan

Goal: Publish the existing complete video agent without depending on this PC.

Architecture: Workers serves the existing UI and validates instructor codes. A signed, HttpOnly cookie routes each instructor code to its own Container. Node/FFmpeg runs there; R2 stores settings, OAuth tokens and job files and restores them after container restarts. Existing Supabase relay remains the model gateway.

Constraints: preserve local launch; no keys in browser or repository; no shared student tokens/files; no paid AI generation during verification; Cloudflare usage costs accepted by user.

- [x] Test and implement signed sessions, tenant storage keys, and durable file sync.
- [x] Adapt Node binding, OAuth callbacks, popup handling and uploads for the public origin; retain local behavior.
- [x] Build a Linux Node/FFmpeg image, configure R2/Workers/Containers, run dry-run and automated tests.
- [x] Review changes, deploy, and verify login gate, isolated workspaces, media upload/thumbnail, persistence and desktop/mobile screenshots.

Verification: 11 automated tests pass; local HTTP 200; real cloud FFmpeg/ffprobe and public OAuth registration succeed; tenant isolation checked; final-image instance IDs changed e38bf5a6 → 492b6741 on full stop/start with identical persisted media bytes. Mobile navigation exposes previously hidden panels. No paid model/media generation performed.

Review: separate reviewer identified shutdown races, code replacement isolation and missing review sheet persistence; all fixed with regression coverage. Cloudflare stop() only sends a signal, so shutdown now flushes with ingress quiesced and awaits destroy() to ensure actual termination.

Review focus: forged cookies; cross-tenant storage access; interrupted uploads/FFmpeg output; OAuth state/redirect mismatch; restoring files after idle shutdown.

Ruling: work in the fresh dedicated clone on feat/cloudflare. The user approved the full cloud architecture and requested deployment, so proceed through implementation and deployment without another routine permission request.
