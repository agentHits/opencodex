# Evidence ledger

Filled as the cycles complete. Every row names the source of the claim.

## Frozen facts

| Item | Value | Source |
| --- | --- | --- |
| Released baseline | `v2.49.0` / `main` `2f3f736299dca38861f8fb9c4326a4b4d7c664bc` | `git log origin/main` |
| Audit candidate | `dev` `12c248f52bed88ea13be5b284c79a238feb592d1` | `git rev-parse origin/dev` |
| Candidate version | `2.50.0` | `package.json` |
| Commits in delta | 127 | `git rev-list --count 2f3f73629..origin/dev` |
| Changed files | 1066 total, 885 `devlog`, 181 non-`devlog` | `git diff --name-only 2f3f73629...origin/dev` |
| `preview` version line | `2.49.0-preview.20260909` | `git show origin/preview:package.json` |
| Open PRs against `dev` | 74 | `gh api "repos/lidge-jun/opencodex/pulls?state=open&base=dev&per_page=100" --jq 'length'` |

## wp1 — roadmap audit (A gate)

Reviewer: `xai/grok-4.6`, agent `01a08a86-1352-77a2-98bd-5c167b5479c8`, read-only, fresh context.
Verdict: **FAIL**. Every finding was verified independently by the main session before folding.

| # | Finding | Verified by | Fold |
| --- | --- | --- | --- |
| R1 | `src/cli/{capabilities,index,models-runtime,observe}.ts` belonged to no lane | `git diff --name-only` vs the lane map | Lane **L6** added |
| R2 | Blocker definition missed new-path breakage, consent/identity-spend bypass, `AGENTS.md` core invariants, upgrade-path recovery, and operator-surface drift | `AGENTS.md:43-83`, `AGENTS.md:150-169` | Definition rewritten to 8 clauses |
| R3 | `release.yml:179-197` needs a push-event `ci.yml` run on the release branch for `$GITHUB_SHA`; a `dev` dispatch does not qualify | `sed -n '179,197p' .github/workflows/release.yml` | Order rewritten: gates run on the `main` merge SHA |
| R4 | `service-lifecycle.yml` is gated on `$GITHUB_SHA`, and this delta arms it via `src/cli/index.ts` + `package.json` | `sed -n '225,237p' .github/workflows/release.yml` | Made an explicit step on the merge SHA |
| R5 | `preview` refuses a non-`*-preview.*` version, and `origin/preview` is `2.49.0-preview.20260909` | `sed -n '161,165p' release.yml`; `git show origin/preview:package.json` | `preview` removed from the stable train |
| R6 | `dev-version-bump.yml` is `on: workflow_dispatch`, not `workflow_call`-only | `sed -n '24,45p' .github/workflows/dev-version-bump.yml` | Pre-move now uses the workflow, not a hand PR |
| R7 | `dry-run` defaults to `true` and the run must come from `refs/heads/main` | `sed -n '22,26p'`, `sed -n '153,170p'` `release.yml` | Dry-run-then-publish made explicit |
| R8 | Scope doc misattributed the 121-file figure, derived the devlog count by subtraction, and said 20 open PRs | `git diff --shortstat`; `gh api ... --jq 'length'` -> 74 | Counts table rewritten from the real command |

## Audit findings (wp2)

| ID | Lane | File:line | Failure mode | Blocker | Disposition |
| --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | |

## Release artifacts (wp4)

| Gate | Evidence | Status |
| --- | --- | --- |
| Candidate-tree CI (`dev` dispatch, audit evidence) | run 34457689927 on `12c248f52` | pending |
| `dev` pre-move to 2.51.0 | | pending |
| `main` promotion merge SHA | | pending |
| Push-event Cross-platform CI on merge SHA | | pending |
| Service lifecycle on merge SHA | | pending |
| `release.yml` dry run | | pending |
| `release.yml` publish | | pending |
| npm `latest` = 2.50.0 | | pending |
| `gitHead` matches promoted `main` | | pending |
| git tag + GitHub release | | pending |
