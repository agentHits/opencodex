# Contribution Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject implementation pull requests that lack agreed scope or explicit author ownership, and close abandoned author-action PRs after five inactive days.

**Architecture:** A pure CommonJS validator classifies changed paths, parses linked issues, and validates required author attestations. A trusted `pull_request_target` workflow performs GitHub API lookups and synchronizes admission labels and one bot comment. A separate default-branch scheduled workflow handles inactivity.

**Tech Stack:** GitHub Actions, `actions/github-script`, Node CommonJS, `node:test`.

## Global Constraints

- Never check out or execute pull-request head code from `pull_request_target`.
- Pin third-party actions to immutable full SHAs.
- External implementation PRs require an `approved-for-work` issue.
- Maintainers bypass only the approved-issue requirement, not attestations.
- Warn after three inactive days in `awaiting-author`; close after two more.
- Passing intake is not approval.

---

### Task 1: Pure admission validator

**Files:**
- Create: `.github/scripts/pr-admission.cjs`
- Create: `.github/scripts/pr-admission.test.cjs`

- [x] Write tests for checked attestations, linked-issue parsing, implementation-path classification, approved issue behavior, and maintainer bypass.
- [x] Implement the smallest pure validator that passes those tests.
- [x] Run `node --test .github/scripts/pr-admission.test.cjs`.

### Task 2: Trusted PR intake workflow

**Files:**
- Create: `.github/workflows/pr-admission.yml`

- [x] Check out only trusted default-branch scripts.
- [x] Read live PR files, body, author permission, and linked issue labels through GitHub APIs.
- [x] Apply `awaiting-author` on failure and `intake: admitted` on success.
- [x] Upsert one actionable bot comment.
- [x] Fail the `admission` job when requirements are not met.

### Task 3: Author-action staleness

**Files:**
- Create: `.github/workflows/stale-author-prs.yml`

- [x] Limit processing to PRs labeled `awaiting-author`.
- [x] Warn after three inactive days.
- [x] Close after two additional inactive days.
- [x] Leave maintainer-blocked PRs untouched.

### Task 4: Submission contract and design record

**Files:**
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `docs/superpowers/specs/2026-08-02-contribution-firewall-design.md`
- Create: `docs/superpowers/plans/2026-08-02-contribution-firewall.md`

- [x] Add linked-issue, verification, regression-evidence, UI-evidence, and author-responsibility sections.
- [x] Record security boundaries, exemptions, non-goals, and staged rollout.

### Verification

- [x] `node --test .github/scripts/pr-admission.test.cjs`
- [ ] GitHub Actions for the exact PR commit.
- [ ] Synthetic external fork PR after workflow promotion to the default branch.
