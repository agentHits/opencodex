# Round ledger

Refreshed by the orchestrator from `gh`, never from narration. `NOT RUN` is the honest value for
every local product check in this round.

## Round PR

| PR | Head | Gate checks | Product jobs | Note |
|---|---|---|---|---|
| #4217 | `39409f9e811dc6f253a2f6bb9b92287bf2a6e73d` | `enforce-target`, `hygiene`, `label`, `resolve-pr`, `ci`, `changes`, `react-doctor`, `select windows runner` all SUCCESS | SKIPPED | Docs-only: the `changes` filter skips product legs by design |

## Lanes

| Lane | Worktree | Branch | Seed commit | Thread | PR | Head SHA | Final-head CI | State |
|---|---|---|---|---|---|---|---|---|
| L1 | `~/.codex/worktrees/260911-l1/opencodex` | `codex/260911-l1-responses-core` | `4d11c08d5` | pending | — | — | — | packet seeded |
| L2 | `~/.codex/worktrees/260911-l2/opencodex` | `codex/260911-l2-catalog-provider` | `4fa25c8dc` | pending | — | — | — | packet seeded |
| L3 | `~/.codex/worktrees/260911-l3/opencodex` | `codex/260911-l3-account-pool` | `8193ba524` | pending | — | — | — | packet seeded |
| L4 | `~/.codex/worktrees/260911-l4/opencodex` | `codex/260911-l4-service-cli` | `94b47e9a0` | pending | — | — | — | packet seeded |
| L5 | `~/.codex/worktrees/260911-l5/opencodex` | `codex/260911-l5-integrations-io` | `50ec0b5db` | pending | — | — | — | packet seeded |
| L6 | `~/.codex/worktrees/260911-l6/opencodex` | `codex/260911-l6-streaming-tools` | `582bdb457` | pending | — | — | — | packet seeded |
| L7 | `~/.codex/worktrees/260911-l7/opencodex` | `codex/260911-l7-docs` | `512a3e467` | pending | — | — | — | packet seeded |

Base freeze for every lane: `6d3ad12e3`.

## Local checks

`bun test`, `bun run test`, `bun run test:changed`, `bun run typecheck`, `bun run build:gui`,
`bun install`: **NOT RUN** in this round, by operator instruction. Hosted CI on each exact pushed
head is the only product evidence this round will cite.

