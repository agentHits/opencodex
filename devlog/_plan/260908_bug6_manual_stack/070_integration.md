# wp7: hosted verification and integration

Depends on wp1–wp6. The owner explicitly requested a single manual branch chain. This cycle changes only its delivery records and evidence; a discovered product defect is assigned an audited repair cycle before integration continues.

## File changes

- MODIFY this unit's `000_plan.md`: replace in-progress outcomes with exact source commit, PR, run IDs, tested heads and terminal dispositions; record failed/skipped checks separately.
- NEW `071_delivery.md`: six-row original-to-carried PR mapping, attribution, pinned GitHub evidence, active branch/base topology and merge result per layer. Store no account identifiers or private payloads.
- NEW `072_final_proof.md`: fetched dev SHA; per-layer ancestry command results; final candidate tree and landed tree comparison; unchanged pre-existing-file fingerprint verification. If a merge commit contains concurrent changes, isolate and explain each difference rather than claiming whole-tree equality.
- MOVE this completed unit to `devlog/_fin/260908_bug6_manual_stack/` only when all outcomes are terminal. Evidence generated before moving records both paths. Do not move other units.
- GUI screenshot files, if needed, use the existing `.github/pr-assets/` convention after verifying the generated image contains synthetic settings only.

## Exact delivery actions

1. For each nonempty candidate use a new owned `codex/bug6-01a07e9d-*` branch. Bottom base is dev; each upper base is the prior owned branch. Preserve author trailers and satisfy every section of `.github/PULL_REQUEST_TEMPLATE.md`.
2. Commit with `git -c core.hooksPath=/dev/null commit`; push with `git -c core.hooksPath=/dev/null push --no-verify`. No install, test, typecheck or build hook runs locally.
3. Read each PR's current head/base and native `stack` field. A native membership conflict is inspected without mutating membership. Our newly created ordinary PRs must remain manual.
4. Inspect `gh pr checks` and matching workflow runs. Before landing obtain final candidate `ci.yml` `workflow_dispatch` with `lane=all` as well as required PR checks. Bind conclusions to `head_sha`, event and run attempt. Retry failed jobs only after investigating the actual failure and ensuring it does not hide a product regression.
5. For the preset UI, download the hosted `dashboard-preview-*` artifact from the verified head. Verify `build-commit.txt` and `build-gui-tree.txt`; serve the prebuilt bundle with synthetic API fixtures on a disposable loopback port; observe preset activation/restoration and server-switch behavior in a browser; capture/read the screenshot. No local product compilation. Existing browser driver only, no installation.
6. Refresh MAINTAINERS.md, live actor permission, reviewer objections and security evidence. Record maintainer integration in the owned PR body. The repository deletes merged head branches: inspect direct children and retarget our next child to dev immediately before merging its parent, so automatic deletion cannot close it. Land only the bottom PR with `--match-head-commit`; verify the resulting integration head and CI evidence before advancing. Never merge an upper PR into its parent branch as if that landed it in dev. Do not change repository settings or unrelated children.
7. Fetch dev after each merge and prove the merged commit is an ancestor. At final integration compare actual trees against the final certified candidate, including any explicitly reviewed concurrent dev changes.
8. Refresh each original item and mark closed only if its entire user-visible bug is resolved by the landed tree. Preserve unresolved residuals as open; report the exact residual rather than treating overlap as duplication.

## Activation and observation

- Failed/queued/cancelled hosted job: inspect actual run/head; no merge until required evidence is successful.
- Base advances: recompute integration tree and obtain fresh evidence; old SHA checks are historical.
- A maintainer objection remains: resolve its concrete finding or obtain withdrawal before merge.
- A source PR lands concurrently: verify its actual delta and remaining contract; use an evidence-backed NOOP rather than reapplying it.
- UI stale-server or malformed-recommendation fixture: preset install disabled; custom edit/clear retained; no cross-server write.
- Final condition: all six source contracts mapped to landed results; no destructive changes to user files, service state or credentials.

## Validation limits

Local product tests, installs, typechecks and builds: NOT RUN by owner instruction. Hosted tests and independent source audits provide product evidence; docs-only filesystem/link/whitespace checks provide document evidence. Neither substitutes for the other.

## wp7 P refresh

Previous wp6 D:6904ecd9c passed CI34188893148 and source/security/interdiff audits; coldmain, busy, same-tick replacement and converged-flight regressions passed; docs425pages plus renderedlink/KOparity passed. Latestdev402be7c1f is pinned for integration. Read-only merge-tree predicts conflicts only in reference/management-api.md and codex-auth-api.test.ts because dev already contains the canonicalalias prefix. Both dev versions exactly equal our adopted alias predecessor9eb44cfb4; resolve those two to our current versions, which include that prefix plus the audited recovery. No pre-existing userfile overlaps the incomingdevdelta.

Merge402be7c1f into the topbranch with hooksdisabled, preserving all other incomingfiles. Record exactresolvedtree, recheckcurrentdev, publishnoverify, and dispatchci.yml lane=all on that exacthead. NewPRchain is3986→3991→3992→3993→4002;3965alreadymerged. All original candidateheads retain passingPRCI; any rewrittenhead gets freshproof. Refresh each target/head/membership/review/CI before its separately authorized ordinary merge. Use merge commits to preserve ancestry/attribution, retarget each nextchild todev, and prove resolved integration content is covered by the certifiedtop. Current-headrequiredchecks and source/security duties remain separate.

After productlanding, close only satisfied sourceitems, including superseded3995 aftercore3973lands; preserve3997. Archive this unit with an evidence-only closing PR if needed, so completedrecords do not change the tested product tree. Verify that closingdelta is documentation-only and receives its properCI; retain exact product-tree equivalence to the full-matrix candidate rather than attributing skipped productjobs to passingexecution. No release/main/preview/deployment changes.

## Final CI repair amendment

Full run34190287787 at f1b436324 failed Windows3/6: the first restart-help correctness test returned an unobserved exit status after its fixed10s synchronous subprocess bound. Other observed shards passed; wait for the complete run before deciding whether any additional repair is needed. The source investigation does not establish a Bun defect or a startup latency cause.

Modify only `tests/cli/cli-restart-health.test.ts` for this repair. Replace synchronous spawning with awaited Bun.spawn, existing captureTestOutput and watchdogMs(10000). Preserve all eight command tests, arguments, private homes, output assertions and legitimate health exit1. Independently bound execution, TERM grace5s, KILL reap2s and output drain1s; clear timers and keep timeout, signal, rejected observation, incomplete output and unreaped child as failures even after eventual exit0/1. Use an outer cleanup envelope below the existing60s CI ceiling. Keep child ownership and avoid deleting an unreaped child's private home. Emit safe stage/PID/exit diagnostics without inherited environment or credentials. Add small controlled wrapper regressions for sticky timeout, incomplete output at0/1, unreaped child and spawn/observation errors; reuse capture-owner coverage for its internals. No production CLI or workflow timeout changes, assertion removal, skip, retry loop or local product execution.

An independent plan audit precedes implementation; an independent patch audit precedes publication. Publish the repaired top head with hooks disabled and --no-verify, obtain fresh PR checks and a new full lane=all dispatch on that exact SHA, and verify the original Windows lane. Passing results establish that head's observed outcomes, not the historical root cause. The final docs build runs remotely on the integrated docs tree. Preserve failed-run evidence and all prior user files.
