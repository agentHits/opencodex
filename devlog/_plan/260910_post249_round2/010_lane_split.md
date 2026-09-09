# Lane split, stacking, and merge control

## Why two lanes and not eight

Round 1 ran eight parallel worktrees. Every lane opened one PR, and the main
session spent most of its time on merge bookkeeping rather than on the changes.
Two lanes with four stacked PRs each keep the same eight changes but give each
worktree a single reviewer-visible chain, so a conflict inside a lane is a
rebase the lane owns and a conflict between lanes cannot happen at all — the
write sets are disjoint by construction.

## Write sets (disjoint)

**Lane A — server runtime.**
`src/server/responses/core.ts`, `src/claude/inbound.ts`, the served-catalog
quota projection, `src/service.ts`, and their tests under `tests/server/`,
`tests/claude/`, `tests/catalog/`, `tests/service/`.

**Lane B — dashboard, catalog UX, and management projection.**
`gui/`, the Logs/usage projection that feeds it, the catalog price metadata
path, `src/lib/privacy.ts` and the management DTO call sites, and their tests
under `tests/gui/`, `tests/config/`, `tests/server/management/`.

The one place the lanes could meet is the served catalog: #1711 (Lane A) writes
catalog *state*, #3666 (Lane B) reads catalog *price metadata* in the GUI. They
touch different fields; if a lane discovers real overlap it reports instead of
reaching across.

## Stack shape

Each lane publishes an ordinary manual chain, bottom-up, on the `dev` commit the
lane started from:

```
dev (cd813d3d9)
  └─ lane-a/1-4129   PR base dev
       └─ lane-a/2-4148   PR base lane-a/1-4129
            └─ lane-a/3-1711   PR base lane-a/2-4148
                 └─ lane-a/4-4141   PR base lane-a/3-1711
```

No GitHub native stacks. `enforce-target` skips the wrong-base gate for a child
PR whose base is another open PR's head branch, which is what makes this legal.
After a parent merges, the child is retargeted to `dev` — **by main-session
instruction, not by the lane**.

## Why #4141 sits last in Lane A

PR #4152 (`fix(service): stop the test suite from mutating a live service
manager`) is open, not draft, mergeable, and rewrites the same `launchctl`
runner in `src/service.ts` that #4141 has to change. It belongs to a separate
task investigating the live-proxy shutdowns. Putting #4141 at the top of the
stack means it is the last thing to merge, so #4152 lands first and #4141
rebases onto it instead of racing it.

## Merge control

The main session merges in completion order, not lane order. The rule for each
merge is the same one round 1 used:

1. The PR is not draft, `mergeable`, and its base is `dev`.
2. There is a CI run at the **exact head SHA** that concluded `success`.
   `gh run view <id> --exit-status` is the verdict; a cancelled run is not.
3. Merge, then fetch and prove `dev` ancestry before closing the issue.
4. PRs here target `dev`, so GitHub does **not** auto-close the linked issue.
   Close it manually with the merge commit as evidence.

Rebase instructions are issued by the main session only, and only when a merge
has actually moved `dev` under a still-open child.

## Lane operating contract

Each lane thread runs the `cxc-loop` + `cxc-dev` discipline: one PABCD cycle per
stack item, its own `xai/grok-4.6` subagents for bounded verification, a devlog
decade doc per item, and `--no-verify` pushes. A lane never runs the local
suite, never merges, never rebases without instruction, and never touches the
service manager.
