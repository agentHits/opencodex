# Contribution firewall rollout

The workflows in the five-PR stack are inert for external pull requests until their trusted scripts and workflow definitions are on the repository default branch. Do not configure required checks before the synthetic-fork validation below.

## 1. Promote trusted automation

Promote the merged `dev` versions of these files to the default branch:

- `.github/workflows/enforce-pr-target.yml`
- `.github/workflows/pr-admission.yml`
- `.github/workflows/pr-readiness.yml`
- `.github/workflows/pr-trust-lane.yml`
- `.github/workflows/pr-hygiene.yml`
- `.github/workflows/pr-review-lifecycle.yml`
- `.github/workflows/stale-author-prs.yml`
- their corresponding `.github/scripts/*.cjs` files
- `.coderabbit.yaml`

## 2. Synthetic fork test

Open a fork PR against `dev` and prove each transition:

1. Missing approved issue and unchecked attestations fail admission and produce `awaiting-author`.
2. Correcting intake moves to `intake: validating` while checks run.
3. A failing CI or CodeRabbit check returns to `awaiting-author` and keeps the PR draft.
4. All checks passing produces `awaiting-maintainer` and restores ready-for-review only when automation owned the draft.
5. A first-time contributor is blocked by a second active implementation PR, an unapproved change over 500 lines, and a restricted security/release surface without sponsorship.
6. Hygiene fixtures prove missing tests, suppressions, focused tests, empty catches, generated output, and lockfile churn fail.
7. Two `CHANGES_REQUESTED` reviews on distinct head SHAs produce `review: limit-reached`; duplicate reviews on one SHA do not increment.
8. `awaiting-author` stales after three inactive days and closes after two more; `awaiting-maintainer` never stales.

## 3. Configure the `dev` ruleset (owner/admin)

The connected `Wibias` account has write access but not repository admin access, so the project owner or another administrator must perform this step.

- Require pull requests before merging.
- Require at least one approval and prevent author self-approval.
- Require CODEOWNERS approval.
- Dismiss stale approvals when new commits are pushed.
- Require approval of the most recent reviewable push.
- Require all review conversations to be resolved.
- Require these checks after their exact names are confirmed by the synthetic test:
  - `Enforce PR target branch / enforce-target`
  - `PR admission / admission`
  - `PR readiness / reconcile`
  - `PR trust lane / trust-lane`
  - `PR hygiene / hygiene`
  - the cross-platform CI jobs required by current release policy
  - CodeRabbit's blocking review check
- Restrict bypass permissions to emergency owner/maintainer recovery only.

## 4. Enable merge queue

Enable the merge queue for `dev` after required checks are stable. Require queued commits to rerun the same checks against the current integration state. Do not enable auto-merge as a substitute for approvals or unresolved-thread checks.

## 5. Measure before tightening

For two weeks, record:

- admission failure rate;
- abandonment and reopen rate;
- first-pass CI success;
- substantial review rounds per merged PR;
- maintainer review time;
- closures by standardized reason.

Change thresholds only from this evidence. Commit count and guessed AI origin are not quality metrics.
