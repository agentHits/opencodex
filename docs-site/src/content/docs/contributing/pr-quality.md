---
title: Pull request quality contract
description: Review readiness, contributor responsibility, trust lanes, and closure policy for OpenCodex pull requests.
---

## Earn maintainer review

Opening a pull request does not transfer responsibility for the branch to the maintainers. Human review begins after the automated intake, trust-lane, hygiene, CI, and CodeRabbit gates pass and the PR is labeled `awaiting-maintainer`.

Authors must understand every changed line, provide exact validation evidence, add focused regression coverage for behavior changes, and remain available to resolve CI and review feedback. Maintainers identify problems; they are not expected to repair contributor branches, write missing tests, or repeatedly translate automated findings into patches.

## Approved scope

External implementation work starts from an issue labeled `approved-for-work`. Documentation-only changes and maintainer-owned integration work are exempt. First-time contributors may have one active implementation PR, are limited to 500 changed lines unless the issue has `large-change-approved`, and need `maintainer-sponsored` for authentication, workflow, release, or dependency surfaces.

## Review rounds

A substantial review round is a maintainer change request on a distinct revision with actionable explanation. Multiple reviews of the same commit count once. After two unsuccessful rounds, maintainers may close a PR that still needs architectural repair, repeatedly reintroduces defects, or shows that the author cannot own the implementation. The author may return with a clean replacement PR.

## Author inactivity

PRs labeled `awaiting-author` receive a warning after three inactive days and close after two more. Updates reset the timer. PRs labeled `awaiting-maintainer` are never closed for contributor inactivity.

## Closure reasons

Maintainers use standardized labels: `close: no-approved-issue`, `close: not-review-ready`, `close: abandoned`, `close: excessive-review-churn`, `close: scope-too-large`, `close: wrong-direction`, and `close: insufficient-tests`.
