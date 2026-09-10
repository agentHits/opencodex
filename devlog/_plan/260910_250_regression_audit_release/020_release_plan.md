# 2.50.0 release plan

Order matters: the candidate tree must be frozen before `dev` moves again.

1. **Freeze the candidate.** Record the exact `dev` SHA and require successful
   `Cross-platform CI` and `Service lifecycle` runs on that SHA. `dev` HEAD
   `12c248f52` currently has no run of its own, so the release SHA needs an explicit
   `lane=all` CI dispatch plus a service-lifecycle run before promotion.
2. **Land blockers first.** Any wp3 fix goes to `dev` through a pull request, which moves
   the candidate; re-freeze and re-verify CI on the new SHA rather than reusing old-head green.
3. **Pre-move `dev`.** Bump `dev` past the stable target with `scripts/bump-dev-version.ts`
   through a one-file PR, so `dev` is never equal to the published stable version.
4. **Promote independently.** Open promotion PRs from the frozen candidate into `preview`
   and `main`. Verify the candidate is an ancestor of both; do not assume `preview`
   precedes `main`.
5. **Publish.** Dispatch `release.yml` with `expected-sha` pinned to the promoted `main`
   SHA. Do not run `scripts/release.ts` locally: it requires a clean tree and runs the
   full suite, audit, and privacy scan in a worktree that is not the release worktree.
6. **Verify artifacts.** `npm view @bitkyc08/opencodex dist-tags`, the `2.50.0` `gitHead`
   against the promoted `main` SHA, the git tag, the GitHub release, tarball integrity,
   and SLSA provenance. npm propagation lag returns 404 or a stale `latest`; poll, never
   republish.

## Known failure modes to expect

- Branch-keyed CI concurrency cancels an older run when a newer commit lands. A cancelled
  aggregate is neither a product failure nor passing evidence.
- `dev-version-bump.yml` is `workflow_call`-only and cannot be dispatched by hand.
- The registry-availability smoke can time out after npm already accepted the publish.
  Inspect metadata, provenance, and tarball before considering a retry.
