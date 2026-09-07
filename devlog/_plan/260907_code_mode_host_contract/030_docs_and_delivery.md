# 030 — wp3: SoT sync, push, PR, exact-head CI receipt

Depends on 020. Class C2 for the docs; the push/PR step is external state and is authorized by
the user for this branch only ("no verify로 푸시", "pr올려봐"). Merge is not authorized.

## MODIFY `structure/04_transports-and-sidecars.md`

After the paragraph ending "…or reconstruct output that the code-mode host never emitted." (~line 331)
add one paragraph:

```
Routed code-mode turns also carry the host contract for the nested helpers, stated in the same three
injection sites as the result-emission rule (shared catalog nudge, Cursor code-mode guidance, native
routed Responses instructions): `tools.apply_patch` takes one string whose first and last lines are
the bare patch markers, the isolate has no `import`/`require`, and a command that outlives
`yield_time_ms` is polled through `write_stdin` with empty `chars` rather than a shell sleep loop.
When a paired exec result still carries one of the host's failure strings ("expects a string
input", "The first line of the patch must be", "The last line of the patch must be", "Unsupported
import in exec"), the routed Responses, Kiro, and Cursor result paths append a one-line recovery
hint naming the broken rule. Both halves live in `src/adapters/exec-tool-result-normalize.ts` so
the pre-call and post-hoc wording cannot drift. Nothing rewrites the model's JavaScript or its
patch payload; the host still rejects the call exactly as before.
```

Add a Decision Log entry in the file's existing format (목적과 의도 / 기존 구현 및 제약 조건 /
검토한 주요 대안 / 선택한 방식 / 장점, 단점 및 영향) recording: purpose = stop routed models
abandoning apply_patch after two host rejections; alternatives = repair the argument shape in the
proxy (rejected: MODE B ambiguity, fail-open write), Cursor-only fix (rejected: incident was native
Responses); chosen = shared pair in one module; impact = longer system prompt on code-mode turns
(~600 chars), no behaviour change for OpenAI destinations or flat catalogs.

## MODIFY `docs-site/src/content/docs/guides/codex-integration.md`

In "Routed local tools" after the apply_patch conversion paragraph (~line 331) add:

```
Routed code-mode turns are also told the host's rules for the nested helpers before the first
call — `tools.apply_patch` takes one string starting at `*** Begin Patch`, the isolate has no
`import`, and long-running commands are polled with `write_stdin` — and when a result still
carries one of the host's failure messages, opencodex appends a one-line hint naming the rule.
The model's code and patch text are never rewritten.
```

Translated locales (7 files) are not edited; the English source gains a paragraph they do not
contradict.

## Delivery steps (t3b)

1. `git add -A devlog/_plan/260907_code_mode_host_contract src tests scripts structure docs-site`
   — inspect `git diff --cached --stat` before every commit; only this unit's paths.
2. Commits already made per work-phase with `--no-verify` (wp0 docs, wp1, wp2, wp3 docs).
3. `git push --no-verify -u origin codex/code-mode-host-contract`.
4. `gh pr create --base dev --title "fix(code-mode): state the host contract for nested helpers and annotate host failures" --body-file .tmp/pr-body.md`
   — body follows `.github/PULL_REQUEST_TEMPLATE.md` (Summary / Verification / Checklist), lists
   local checks as NOT RUN, names hosted CI as the verifier. No `gui` mention (no screenshot rule).
5. Poll: `gh run list --branch codex/code-mode-host-contract --json databaseId,headSha,status,conclusion`
   via `exec_command` short calls (each < 30 s); `gh run watch` is NOT used inside one call.
6. Receipt: at phase C, `cxc receipt test --session <id> --cwd <worktree> -- gh run view <run-id> --exit-status`
   where `<run-id>` is the Cross-platform CI run whose `headSha` equals `git rev-parse HEAD`.
   If the head moves (review fix), a fresh run and fresh receipt are required.

## Verification (C)

- `gh run view <id> --exit-status` exit 0 on the exact head; `gh pr view --json headRefOid` equals HEAD.
- `gh pr checks <n>` lists test 1/4..4/4, gates, storage policy, api usage as pass.
- Local suite / typecheck / build: NOT RUN (instruction).

## D record

Append `040_delivery_record.md` with PR number, head SHA, CI run id, per-job results, what did not
improve (LOOP-PESSIMIST-01: prose cannot force compliance; effect on real Grok defect rate is
unmeasured until a live re-probe), and the residual: Anthropic/Google/OpenAI-chat/command-code
tool-result paths do not annotate host failures because they have no exec-result seam today.

