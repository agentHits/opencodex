# 140 — Closeout: supersede closes, jawcode push, staged merge

Follow-on unit to the 2026-08-05 bug-stack campaign. The campaign produced 11
CI-green PRs; this unit disposes the contributor PRs those PRs supersede,
publishes the jawcode price commit, and lands the whole set on `dev`.

User authorization on record (2026-08-05): close every supersede candidate,
push jawcode, then merge the stack one at a time with sol-medium review.
Pushes in this unit use `--no-verify` (user instruction, same date); the local
full suite runs on `ssh lidge` instead of the pre-push hook.

## Ordering note (deviation from 130)

`130_dispositions.md` scheduled each supersede close for *after* its successor
lands. The user ordered closes first, then merges, in the same pass. The
deviation is bounded: every successor is already CI-green and is merged in
this same unit, and each close comment states the successor's merge status
truthfully at the time of writing. If any successor fails to land, its
contributor PR is reopened rather than left closed against nothing.

**Reopen condition is equivalence, not just landing** (audit round 2,
blocker 4). The successors are rebased onto current `dev` before merging, and
a rebase can change behavior through conflict resolution. A contributor PR is
therefore reopened if its successor fails to land **or** if the final merged
successor no longer preserves the equivalence that justified the close.

### Required close-comment shape

Every supersede comment must contain, in this order:

1. The successor PR number and its **audited head SHA**, stated as *open and
   not yet merged* at the time of the comment.
2. What of the contributor's work was **adopted**, with the mechanism named.
3. What was **deliberately not matched**, with the reason.
4. The explicit note that current-base revalidation and CI on the rebased head
   are still pending, and the reopen condition above.

No comment may claim the fix "has landed", is "on `dev`", or is verified
against current `dev`.

## wp1 — supersede closes + jawcode push

| PR | Author | Successor | Close basis (from decade doc) |
|---:|--------|-----------|-------------------------------|
| #966 | @Yuxin-Qiao | #1023 (issue #914) | 030 §equivalence: closest semantic source; classifier + regular/Compact retry semantics adopted; the 22-file sidecar blast radius deliberately not inherited |
| #922 | @luvs01 | #1023 (issue #914) | 030 §equivalence: host-health ledger + ordered attempt observations adopted; admission/circuit-breaking, host-only timeouts, redirect→502 rejected as policy expansions beyond #914 |
| #928 | @0xWinner98 | #1025 (issue #893) | 040 §equivalence: config shape, field backfills, JSON path, explicit-`output: []` preservation, bounds adopted; field-only normalization is not stream commitment, so lifecycle event synthesis was added on top |
| #940 | @mouzhi | #1027 (issue #938) | 060: ID-prefix idea equivalent and adopted; the rest of the bundle (response-ID aliasing, dropped `response.in_progress`, synthesized envelopes, logprobs stripping, relay surgery, `[DONE]` synthesis) is outside #938's acceptance boundary and is not matched |
| #1006 | @Michael-Han0608 | #1026 (issue #875) | 050: core policy (bounded upstream JSON for DeepSeek Flash) adopted; the duplicate JSON→event algorithm, persistent `_clientRequestedStream` parser state, missing `[DONE]` trailer, and SSE-item-ID-repair bypass are not matched |

`#961` is **not** in this table. 120 recorded it as ADOPTED with authorship
preserved. It does **not** auto-close: #1033's body says `Closes #961`, but a
closing keyword closes linked *issues*, not another pull request
(`closingIssuesReferences` for #1033 is empty). After #1033 lands, #961 is
closed explicitly with an adoption comment naming the carried commits
(`71ac00af8f82`, `e56dfbdc1bc8`, author Yuxin Qiao) and the hardening slice
added on top. Audit round 1, blocker 1.

Size figures quoted from the decade docs are the review-time snapshots; the
contributor PRs have since grown (#966 is now 25 files, #940 is 16 files /
975 changed lines). Close comments cite behavior, not line counts.

jawcode: push `63aefba` on `codex/gpt-5.6-price-cut-refresh` to
`lidge-jun/jawcode`. Branch only — `dev` is not touched.
**Status: pushed 2026-08-05** — `git ls-remote` shows
`63aefbaaa4bcba6c9ed8cbb5640eb19cbc9baed8` on the branch; `dev` stayed at
`c353d7b5`.

## wp2 — stack train

Merge order and retarget rule: each child's base is its parent's branch, so the
child is retargeted to `dev` only after the parent merges (GitHub retargets
automatically on merge; verify before merging).

`#1020` → `#1023` → `#1025` → `#1026` → `#1027`.

### Merge method is load-bearing (audit round 1, blocker 3)

All five branches fork from `6ed4c7807862`; `dev` has since moved to
`2a72aa4a9b08`. A graph simulation showed the failure mode concretely:

- **Merge commit** for #1020 keeps merge-base `2724c76157c4`, so the
  retargeted #1023 still presents its intended 15-file layer.
- **Squash or rebase** for #1020 leaves the merge-base at `6ed4c7807862`, and
  the retargeted #1023 balloons to 34 files — it re-presents every #1020
  campaign doc and Anthropic change as its own.

Therefore the train merges with **merge commits only** (`gh pr merge --merge`).
Squash/rebase is allowed only if every descendant is cascade-rebased
immediately afterwards.

### Rebase cascade (audit round 2, blocker 2; round 3, blockers 1-3)

Rebasing a train head rewrites its commits, which orphans every descendant's
ancestry. Rebasing #1020 alone leaves #1023–#1027 pointing at the old commits;
rebasing #1023 after retarget breaks #1025–#1027 the same way. The train is
therefore refreshed as **one cascade**, never per-PR:

```bash
git fetch origin dev
old_base=$(git merge-base origin/dev codex/stack-05-uuid-item-ids)
git rebase --update-refs --onto origin/dev "$old_base" codex/stack-05-uuid-item-ids
```

`old_base` is computed **per cascade**, after fetching `origin/dev` and before
any ref moves (round 3, blocker 3). Reusing the original fork point
`6ed4c7807862` on a second cascade would drag already-rebased history back in.

The push is **atomic** (round 3, blocker 2). Sequential force-pushes would
briefly — or, on a mid-way failure, permanently — pair a rewritten parent with
a stale child. Capture all five pre-rebase remote SHAs, then move all five refs
in one command:

```bash
git push --atomic --no-verify \
  --force-with-lease=refs/heads/codex/stack-01-anthropic-error-fidelity:<old01> \
  ... (one lease per branch) ... \
  origin codex/stack-01-...:codex/stack-01-... (all five refspecs)
```

If the atomic push is rejected or any lease fails, **no ref moves**: refresh
the graph and repeat the whole cascade. There is no sequential fallback.

After the cascade, verify every PR's `baseRefOid`/`headRefOid` pair, re-read
each layer's diff to confirm the per-PR file counts did not inflate (the
audited post-cascade sizes are 19 / 15 / 17 / 7 / 13 files for stack-01
through stack-05), and re-run required CI per layer.

**No child is rewritten after the cascade** (round 3, blocker 1). Once a parent
lands by merge commit, `dev` moved *only* through that merge, so the retargeted
child's base tree is already equivalent and it merges as-is. If `dev` moves for
an unrelated reason mid-train, abort, repeat the entire cascade from stack-05,
and re-run every layer's review and CI.

### Merge-time pinning (audit round 2, blocker 3)

A green check and a reviewed diff both describe a specific SHA. Between review
and merge either side can move — `dev` already moved from `2a72aa4a9b08` to
`a594938c579c` (#1005) during planning. Each merge therefore:

1. Captures `headRefOid` and the current `dev` OID **before** review.
2. Confirms the lidge verify worktree is checked out at exactly that head tree.
3. Re-reads both OIDs immediately before merging and aborts if either moved.
4. Merges with `gh pr merge <n> --merge --match-head-commit <audited-head-sha>`
   so GitHub itself refuses a moved head.
5. On any change: repeat rebase, diff review, CI, and the full suite.

Stale-green risk: `dev` has changed `src/server/responses/compact.ts` and
`core.ts` (overlaps #1023, #1025, #1026) and `router.ts` (overlaps #1027)
since the fork. GitHub reports all five `CLEAN`, but a clean textual merge is
not a passing test run. The cascade above puts the whole train on current `dev`
once; required CI is then re-run per layer on that exact combination, and the
local full suite runs on `ssh lidge` in the dedicated `/tmp/ocx-merge-verify`
worktree so the host checkout's unrelated dirty state is untouched.

Baseline for this unit is live `dev` at merge time, re-read per merge — not a
hardcoded SHA. The figures above are the planning-time snapshot.

## wp3 — independent lanes

`#1028`, `#1029`, `#1030`, `#1031`, `#1032`, `#1033`. All already based on
`dev`; merge order is free, but each rebases on the previous landing, so CI is
re-checked per merge. Audit confirmed no lane pair writes the same file, and
no lane touches a file `dev` changed between `6ed4c7807862` and `2a72aa4a9b08`.
After #1033 lands, close #961 explicitly.

## Gate per merge

1. sol-medium reviewer reads the real diff (`gh pr diff`) against `dev` head.
2. Blockers fixed and re-verified, or verdict PASS.
3. `gh pr checks` green at the head SHA being merged.
4. Base is `dev`.
5. After merge: `git merge-base --is-ancestor <merge-sha> origin/dev`.

## Maintainer-approval gap — OWNER POLICY OVERRIDE, requirement UNSATISFIED

[`MAINTAINERS.md`](../../../MAINTAINERS.md) requires a non-author maintainer
approval per PR and an explicit security review for auth/credential/OAuth/
workflow/release surfaces. None of #1020–#1033 carries an `APPROVED` review;
requests to `Ingwannu` and `Wibias` are outstanding. Security-boundary heads
by the audit's reading: #1020 (`src/adapters/anthropic.ts` error-body
extraction + redaction), #1023 (`src/codex/routing.ts` account health, probe
leases, credential-bearing redirects), #1025 (`src/server/auth-cors.ts`,
owned by the security set in `.github/CODEOWNERS`), #1029
(`src/cli/account-auth.ts` authorization URLs / device codes on stdout),
#1032 (`src/oauth/kiro.ts` credential-to-profile binding), #1033
(`src/cli/runtime-api.ts`, `src/server/management/provider-routes.ts`
credential-capable headers).

This requirement is **not satisfied**, and nothing in this unit satisfies it.
Adversarial subagent review is a substitute control, not compliance: a subagent
is not a maintainer and cannot submit an `APPROVED` review (audit round 2,
blocker 1). The repository owner directed this merge pass with the campaign's
own author-side evidence, and the owner cannot self-approve under
`MAINTAINERS.md` lines 47-49.

So this is recorded as an explicit **owner policy override**: the merges
proceed on the owner's authority with the approval requirement knowingly
unmet, and the compensating control is per-PR adversarial diff review plus
re-run CI and a full local suite on the rebased head. History shows the gap
rather than a claim of compliance.
