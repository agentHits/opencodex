# PR readiness and CodeRabbit gate — Design

**Stack:** 2/5, based on `agent/pr-contribution-firewall`

## Goal

Prevent human review from starting while admission, CI, or CodeRabbit is incomplete or failing. Keep pending automation separate from author neglect so stale automation never closes a PR merely because CI is still running.

## States

- `awaiting-author`: admission or an automated check failed.
- `intake: validating`: admission passed, but checks are pending or have not reported.
- `awaiting-maintainer`: every observed check and CodeRabbit status passed.
- `intake: auto-drafted`: the workflow owns the draft transition and may restore ready-for-review when gates pass.

While the admission check is still running, a PR without `intake: admitted` is classified as `intake: validating` rather than `awaiting-author`, so concurrent admission and readiness runs cannot mislabel a compliant PR or start its inactivity timer.

Admission and reconcile check runs are excluded from post-admission evidence (the check-run names match the job names `admission` and `reconcile`, with the display-name forms kept as fallbacks), repeated runs on the same head SHA are deduplicated per check name, reconciliations for one head SHA are serialized through the concurrency key, and author-controlled drafts are never queued as `awaiting-maintainer`.

## Safety

The workflow uses `pull_request_target` and default-branch scripts only. It never checks out or executes PR-head code. `status` and `check_run` events reconcile quickly; a 15-minute schedule repairs missed events.

## CodeRabbit

Enable request-changes workflow, review drafts, restrict pre-merge overrides to requested reviewers, and make regression evidence, scope discipline, validation evidence, linked-issue assessment, and description quality blocking checks.

## Rollout

Promote trusted files to the default branch, test on a synthetic external PR, then make the readiness and CodeRabbit checks required through repository settings.
