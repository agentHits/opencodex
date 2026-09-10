# 2.50.0 regression audit and release — scope

## Baseline and candidate

- Released baseline: `v2.49.0`, `main` at `2f3f736299dca38861f8fb9c4326a4b4d7c664bc`.
- Audit candidate: `origin/dev` at `12c248f52bed88ea13be5b284c79a238feb592d1`, `package.json` version `2.50.0`.
- Delta: 127 commits, 1066 files. Product surface is 121 files / +3322 / -280 across
  `src` (62), `gui` (27), `tests` (42), `docs-site` (28), plus one `scripts/test-layout/layout.json`
  entry and the `package.json` bump. The remaining 885 files are `devlog`, which carries no runtime.

## What this unit does

Audit the product delta for release-blocking regressions, remediate anything blocking,
then run the 2.50.0 train: pre-move `dev`, promote the frozen candidate to `preview`
and `main`, publish to npm, and verify the artifacts independently.

## Authorization in force

The user authorized parallel `xai/grok-4.6` subagents, a regression-audit PABCD cycle,
and the release itself. Subagents are read-only verifiers; the main session owns every
PABCD transition, every write, and every external action.

## Out of scope

- Landing unrelated open pull requests. 20 PRs are open against `dev`; none is a
  release prerequisite, and pulling them in would move the candidate tree mid-audit.
- Re-auditing anything already released in 2.49.0.
- Any change to `devlog/` history, `main` outside promotion, or third-party accounts.

## Terminal outcomes

- `DONE` — 2.50.0 on npm `latest` with `gitHead` matching the promoted `main` SHA, a
  git tag, a GitHub release, and a recorded triage for every audit finding.
- `BLOCKED` — a release-blocking regression that cannot be fixed inside this scope,
  or a missing external permission (npm trusted publishing, workflow dispatch).
- `NOOP` — the candidate is already published and verified.
