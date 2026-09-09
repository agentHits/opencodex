# Phase 2 (wp3): pin xAI OAuth endpoints to trusted hosts

Closes #4048 (public, severity: low, filed as hardening). Separate security PR
layered on the phase-1 head because it edits the same file.

Per the repository security-notes policy (root `AGENTS.md`), the assessment and
patch plan for this phase are held in scratch space
(`.tmp/260909_xai_endpoint_security/`, gitignored) until the PR diff itself is
public. This doc records only what the public issue already states, so the
roadmap stays complete without pre-disclosing anything new.

Audit round (2026-09-09, read-only verifier): CONFIRMED — both gaps exist as
filed; the live discovery document returns only `auth.x.ai`, so the trusted-set
pin does not break today's real endpoints. Design decisions beyond the public
sketch are recorded in the scratch plan.

## Public-contract summary (from issue #4048)

`validateXaiEndpoint` (src/oauth/xai.ts:47-54) currently accepts any
`*.x.ai` subdomain via suffix match and preserves URL userinfo, on the URL that
receives the `refresh_token` POST body. The fix pins accepted hosts to the
trusted set and rejects userinfo.

## Constraints this phase must honor

- The live discovery document (verified 2026-09-09) returns only
  `auth.x.ai` for `authorization_endpoint` and `token_endpoint`; the trusted
  set must not reject endpoints the real document returns today.
- Regression tests sit in `tests/providers/xai/xai-oauth-retry.test.ts` (same
  module). The concrete entrypoint cases, fetch-count expectations, and
  assertions are held in the scratch plan until the diff is public.

## Phase entry condition

Phase 2 starts only after phase 1's PR is published, and rebases onto the
published phase-1 head (manual chain: PR2 base = PR1 head branch). Its
pre-written scratch plan is re-verified against the rebased code before
implementation (LOOP-CONTINUITY-01).
