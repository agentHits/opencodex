# Contribution firewall — Design

**Date:** 2026-08-02
**Status:** Draft for maintainer review
**Target branch:** `dev`

## Problem

Low-effort implementation pull requests currently transfer the cost of validation, debugging, and repeated automated-review repair to maintainers. Opening a PR is cheap; proving it is reviewable is expensive. The repository already rejects wrong targets, suspicious ancestry, and empty or malformed descriptions, but it does not yet require authors to demonstrate ownership of the implementation or begin from an agreed scope.

## Decision

Add a second intake layer that evaluates outcomes rather than attempting to detect AI-generated code.

1. Implementation PRs from contributors without repository push permission must reference an open issue labeled `approved-for-work`.
2. Every PR author must check a concrete responsibility attestation.
3. Failed intake applies `awaiting-author`; passed intake applies `intake: admitted`.
4. A scheduled workflow warns after three inactive days in `awaiting-author` and closes after two more.
5. Passing intake means only that the PR may consume CI and maintainer attention. It is not approval and does not replace review.
6. Maintainers may perform integration or urgent repair work without an approved issue, but they do not bypass the author attestation.

## Scope classification

An approved issue is required when any changed path is under `src/`, `gui/`, `scripts/`, `tests/`, `bin/`, or `packages/`, or when the PR changes `package.json`, `bun.lock`, `bunfig.toml`, or `tsconfig.json`.

Documentation-only and repository-policy changes remain exempt so typo fixes and governance work do not require ceremonial issues.

## Security model

`pr-admission.yml` uses `pull_request_target`, checks out only `.github/scripts` from the repository default branch, and never executes the PR head. It reads file metadata, PR text, linked issues, labels, and collaborator permission through GitHub APIs. It receives only the minimum write permissions needed to maintain PR labels and one bot comment.

The scheduled stale workflow is default-branch-only and uses an immutable action SHA.

Linked-issue lookups are capped so untrusted PR text cannot exhaust the API allowance, and transient lookup failures abort before admission labels are mutated. A manual `workflow_dispatch` re-run lets a maintainer re-evaluate a PR after its linked issue gains `approved-for-work`; dispatch is restricted to the repository default branch.

## Author responsibility contract

The PR template requires the author to attest that they:

- reviewed and understand every changed line;
- ran the listed validation;
- supplied regression coverage or explained why it is impossible;
- removed unrelated cleanup and accidental generated churn;
- evaluated automated-review findings critically;
- will remain available for CI and review feedback.

The gate verifies that the checkboxes are checked. It cannot prove the claims are true; false attestation is a review and trust signal, not something automation can solve.

## Deliberate non-goals

- AI-origin detection.
- Automatically deciding whether tests are semantically adequate.
- Counting commits as a quality metric.
- Automatically marking a PR `awaiting-maintainer` before all repository CI is green.
- Enabling branch rulesets in this PR.
- Closing PRs that are waiting on maintainers rather than authors.

## Rollout

1. Review this draft and tune the scope paths, labels, copy, and inactivity window.
2. Merge to `dev`.
3. Promote the trusted workflows and scripts to the default branch.
4. Create or confirm the `approved-for-work` label.
5. Add `PR admission / admission` to required checks only after a synthetic fork PR proves the full failure and recovery path.
6. Measure intake failures, reopen rate, review rounds, and maintainer time for two weeks before tightening further.
