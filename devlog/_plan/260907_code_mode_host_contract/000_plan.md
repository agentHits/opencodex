# 000 — Code-mode host contract for routed models: plan

## Loop-spec

- Loop archetype: satisfy-spec repair (verifier-defined). No optimization loop.
- Trigger: xai/grok-4.6 retrospective (2026-09-07) on a routed native-Responses Codex session. The
  model hit four Codex host contracts that OpenCodex neither states before the first call nor
  explains after the failure, then abandoned the right tools for shell heredocs and sleep loops.
- Goal: a routed non-OpenAI model in Codex code mode learns the host's exact argument shape and
  waiting protocol up front, and when it still trips, the tool result names the rule it broke.
- Non-goals: rewriting model JavaScript; repairing payloads (`apply-patch-envelope.ts`,
  `code-mode-helper-compat.ts`, `bridge.ts`, `parser.ts` untouched); changing OpenAI/ChatGPT
  destinations or compaction requests; Lab; GUI; release/version bumps. No local test suite,
  typecheck, build, or install in this worktree (user instruction). Merge/release out of scope.
- Verifier: hosted `.github/workflows/ci.yml` on the exact PR head (test shards 1-4 + gates:
  typecheck, privacy scan). Local: NOT RUN by instruction. Each conditional path names its
  activation test in the decade docs; those tests ride the hosted shards.
- Stop condition: PR open against `dev` with exact-head CI green and receipt bound; then DONE.
- Memory artifact: this unit (`devlog/_plan/260907_code_mode_host_contract/`), the bound
  goalplan `.codexclaw/goalplans/code-mode-host-contract-for-routed-models-shared/`, PR body.
- Expected terminal outcomes: DONE (PR open, CI green); NOOP if the contract already exists
  (ruled out below); BLOCKED if GitHub/CI infrastructure fails after retries; UNSAFE if a change
  would rewrite JavaScript or widen a fail-open write; NEEDS_HUMAN for merge.
- Escalation: main reclaims a slice after two distinct agents fail its packet; pushing a slice to
  a worker requires a P-phase amendment. Every dispatch uses `gpt-6-astra` reasoning `high`.
- HOTL bounds: write scope is this worktree on `codex/code-mode-host-contract`; tools are
  git/gh/rg/read + `tools.apply_patch`; no token or wall-clock budget was set by the user.

## Incident (what actually broke)

All four strings below were read from the installed Codex 0.153.2 binaries
(`codex` and `codex-code-mode-host`, `strings -n 8`), so the wording here is the host's, not a guess.

| # | Model action | Host response | Where OpenCodex says nothing today |
|---|---|---|---|
| 1 | `tools.apply_patch({ input: "..." })` | `\`apply_patch\` expects a string input` | Nudge says "host-executed" and describes markers, never the argument type |
| 2 | patch built in a template literal opening with a newline | `The first line of the patch must be '*** Begin Patch'` (also `The last line of the patch must be '*** End Patch'`) | Nudge says "begin exactly with" but not that leading whitespace/newline counts |
| 3 | `for i in 1..20; sleep 1` inside one `exec_command` | (no error; the turn just blocks) | No sentence about `session_id` + `write_stdin` with empty `chars` |
| 4 | `import x from "..."` inside the isolate | `Unsupported import in exec: ...` | Cursor normalize matches lowercase `unsupported import in exec` only; shared nudge silent |

After 1 and 2 the model stopped using `apply_patch` entirely. That is the same pattern
`devlog/_fin/260813_260813-nudge-apply-patch-forbid/` recorded: once the tool feels forbidden or
broken, routed models fall back to `python3`/`cat <<EOF` writes that Codex cannot render as diffs.

## Existing mechanism (what we extend, not invent)

`src/adapters/exec-tool-result-normalize.ts` already owns one "pair": a pre-call sentence
(`CODE_MODE_RESULT_ECHO_SENTENCE`) and a post-hoc repair (`EMPTY_EXEC_OUTPUT_MESSAGE`), kept in one
file so the two never drift. The pre-call sentence is injected by three consumers:

- `src/adapters/tool-catalog-nudge.ts:124` (shared: Anthropic, Google, Kiro, OpenAI-chat, command-code)
- `src/adapters/cursor/tool-guidance.ts:187-190` (Cursor code-mode branch)
- `src/adapters/responses-code-mode.ts:27,47` (native routed Responses instructions + exec input description)

and the post-hoc repair runs at:

- `src/adapters/responses-code-mode.ts:55` (paired exec outputs)
- `src/adapters/kiro.ts:758` (toolResult translation)
- `src/adapters/cursor/tool-result-normalize.ts:96-105` (Cursor wrapper; also owns `RUNTIME_FAILURE_GUIDANCE`)

The Anthropic, Google, OpenAI-chat and command-code adapters do NOT run the empty-exec repair on
tool results today (checked `anthropic.ts:786`, `google.ts:422`, `openai-chat.ts:835`,
`command-code.ts:110`). Adding failure annotation there would be a new seam; this unit keeps to
the three seams that already normalize exec results (scope discipline, PHASE-SPLIT-01).

NOOP check: `rg -n 'expects a string input|first line of the patch|write_stdin' src` finds only
`code-mode-helper-compat.ts:54` (compiles a helper alias) and `types/tools.ts:50` (name list). No
guidance names the argument type, the whitespace rule, or the polling protocol. Not a NOOP.

## Design

One new export block in `exec-tool-result-normalize.ts`:

1. `CODE_MODE_HOST_CONTRACT_SENTENCE` — the pre-call half. Three facts in host wording:
   `tools.apply_patch` takes ONE string whose first line is exactly `*** Begin Patch` and last line
   `*** End Patch` (no leading newline/indent); the isolate has no `import`/`require`; a command
   that outlives `yield_time_ms` returns `session_id` and is polled with
   `tools.write_stdin({session_id, chars: ""})`, never a shell sleep loop.
2. `CODE_MODE_HOST_FAILURE_GUIDANCE` — the post-hoc half: a marker → recovery table keyed on the
   four host strings, matched case-insensitively (host emits `Unsupported import in exec:`,
   Cursor's existing marker is lowercase).
3. `annotateCodeModeHostFailure(text, options)` — returns `text + "\n[recovery: ...]"` when the
   result is an exec-bridge tool result (`isCodexExecBridgeTool`) containing a marker and not
   already annotated; else `undefined`. Pure, idempotent, byte-identical on the negative path.

Consumers: the three pre-call sites append sentence 1 next to the echo sentence; the three post-hoc
sites try `annotateCodeModeHostFailure` after the empty-exec check. Cursor's
`RUNTIME_FAILURE_GUIDANCE` import row is replaced by the shared table so the marker and hint have
one owner.

Why prose and not repair: `devlog/_plan/260905_apply_patch_envelope_gap/010_disposition.md` already
refused rewriting JavaScript bodies (MODE B). An object argument or a leading newline inside a
program has the same ambiguity. The fix that is safe here is telling the model the rule before
the call and naming the rule after the failure. `code-mode-helper-compat.ts` keeps its existing
`unwrapPatchInput` for the NAME-alias path; this unit does not touch it.

## Work-phase map (dependency order, PHASE-SPLIT-01)

| WP | Doc | Slice | Depends on | Independently verifiable by |
|----|-----|-------|------------|-----------------------------|
| wp0 | this file + 010/020/030 | docs-only roadmap | — | A-gate audit of the docs |
| wp1 | 010_pre_call_contract.md | shared sentence + three injection sites + tests | wp0 | `tests/adapters/tool-catalog-nudge.test.ts`, `tests/providers/cursor/cursor-tool-definitions.test.ts`, `tests/responses/openai-responses-passthrough.test.ts`, `tests/providers/kiro/kiro-adapter.test.ts` on hosted CI |
| wp2 | 020_post_hoc_annotation.md | shared annotate helper + three result seams + tests | wp1 | new `tests/adapters/exec-tool-result-normalize.test.ts` + updated Cursor/Kiro/passthrough tests on hosted CI |
| wp3 | 030_docs_and_delivery.md | structure + docs-site sync, push, PR, exact-head CI receipt | wp2 | `gh run view <id> --exit-status` on the PR head SHA |

Single PR (one reviewable diff, ~150 source lines + tests); no stack (DEV-STACK-OPT-IN-01).

## Accept criteria (goalplan c1–c4)

- c1: pre-call guidance present in all three code-mode injection sites, absent for flat/OpenAI catalogs.
- c2: exec results carrying any of the four host markers are annotated on routed Responses, Kiro, Cursor; non-matching output byte-identical; already-annotated text not doubled.
- c3: PR open against `dev` with the template body; exact-head hosted CI success; receipt bound.
- c4: each A gate has an independent `gpt-6-astra` audit; `structure/04` and docs-site guide updated.

## Verifiers (PLAN-VERIFIER-REAL-01)

Local execution is forbidden for this unit, so every row below is NOT RUN locally and observed on
hosted CI. "Reads the target" is proven by import paths in the named test files:

- `bun test tests/adapters/tool-catalog-nudge.test.ts` — imports `../../src/adapters/tool-catalog-nudge` and `exec-tool-result-normalize` (file lines 2-7). Reads wp1 target.
- `bun test tests/providers/cursor/cursor-tool-definitions.test.ts` — imports `tool-guidance` (line 762-ish `buildCursorToolGuidanceSystemNote`). Reads wp1 Cursor target.
- `bun test tests/responses/openai-responses-passthrough.test.ts` — imports `responses-code-mode` (line 5). Reads wp1+wp2 native target.
- `bun test tests/providers/kiro/kiro-adapter.test.ts` — imports `exec-tool-result-normalize` (line 16) and exercises `createKiroAdapter`. Reads wp1+wp2 Kiro target.
- `bun test tests/providers/cursor/cursor-toolresult-normalize.test.ts` — imports `tool-result-normalize`. Reads wp2 Cursor target.
- `bun test tests/adapters/exec-tool-result-normalize.test.ts` (NEW in wp2) — imports the shared module directly.
- `bun test tests/test-layout-tooling.test.ts` — reads `scripts/test-layout/layout.json` and `tests/fixtures/test-layout-expected.json`; fails if the new file is unregistered.
- `bun run typecheck`, `bun run privacy:scan` — CI `gates` job.

## Enforcement bypass (PLAN-BYPASS-NAMED-01)

This unit adds guidance, not enforcement. Tier: none (prose the model may ignore). Executing
surface: request translation in the adapters. Known bypass: the model disregards the sentence;
the host still rejects the call exactly as today. Residual risk: none beyond status quo; the
post-hoc annotation cannot make a failed call succeed. Wording: this is an "early warning", not
enforcement. Final layer: Codex host validation (unchanged).

## SoT sync targets (SOT-SYNC-01)

- `structure/04_transports-and-sidecars.md` paragraph at ~line 325 ("Native routed Responses code-mode turns also receive…") — extend with the host contract.
- `docs-site/src/content/docs/guides/codex-integration.md` "Routed local tools" section (~line 315) — one paragraph; translated locales are not edited (they must not contradict, and adding text to English only is additive).

