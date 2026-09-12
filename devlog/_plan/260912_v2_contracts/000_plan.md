# V2 delegation contracts

This unit reconciles plaintext prevention (#2495) separately from encrypted task recovery (#3661). Eligible native parents may opt into plaintext V2 calls; recovery continues to use its existing authenticated, bounded path. The replacement candidates #4242/#4243 are compared against the exact issue contract before any adoption.

Loop: satisfy-spec, triggered by the authorized v2 lane. Goal: scoped carry PRs and final cumulative hosted CI evidence. Non-goals: merges, issue closure, releases, installed service/config changes, native GitHub stacks, local product tests/build/typecheck/install. Local tests are NOT RUN by explicit instruction. Verification: source/diff checks during each cycle; Cross-platform CI on the final published head, with run IDs and conclusions retained. Stop: implementation, audit and CI evidence handed to the integration owner; no claim of integration. Outcomes: DONE with evidence, or an explicit unresolved acceptance/gate. Artifacts: this unit plus ignored `.tmp/v2/` evidence. Escalation: real tool denials and unresolved security/contract blockers are recorded; no new access/settings. Resource bounds: available account/tool permissions, this worktree only, no user token/time/agent-count cap.

| Cycle | Outcome | Design |
|---|---|---|
| wp0 | Docs-only roadmap locked by independent design reflection and A review | this document |
| wp1 | Exact plaintext request/response contract and regression coverage | [010](010_plaintext.md) |
| wp2 | Bounded encrypted envelope handling and residual disposition | [020](020_recovery.md) |
| wp3 | Final cumulative hosted verification and durable handoff | [030](030_verification.md) |

wp1 and wp2 are distinct capabilities; execution order does not itself create a PR dependency. Use independent dev-based PRs if neither consumes the other's changes. A shared final cumulative verification branch may be needed to prove composition; do not silently call intermediate CI final-tip evidence.

Existing owners: `src/adapters/openai-responses.ts`, `src/server/responses/core.ts`, `src/server/responses/agent-task-recovery.ts`; tests remain under domain directories. Source-of-truth pages are mapped by `structure/INDEX.md`. Reuse these owners, not a second server/recovery subsystem. Do-nothing/config-only alternatives cannot provide the missing wire behavior.

Generic supported inherited-model subagents provide independent design consultation and separate review. Native architect selection is unavailable and is not claimed. Original contributor attribution follows the adopted source, including Sigurd-git for #2496 and SB Yoon if any #4242 code is carried. Source PRs/issues remain open or closed in their current state until the integration owner decides.

## Cycle record

wp0: P entered with own session binding; roadmap in progress. Product validation NOT RUN.

wp0 A: Gauss GO-WITH-FIXES (blockers=0); WP1-A01 cache ordering and WP2-A01 fragment owner folded into decade docs. Pasteur reflection ALIGNED; generic inherited-model consultation, native architect not selected.
