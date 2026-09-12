# Closing record

## Outcome

DONE. `gpt-5.4` and `gpt-5.4-mini` no longer exist on the Codex (ChatGPT OAuth) login
surface, and every default that used to dispatch one of them now uses `gpt-5.6-luna`.
Delivered as PR #4327 against `dev`, head `fa1fe32890`, CI 24 pass / 0 fail.

Commits: `a8b26e1342` (this roadmap), `5d664b1a6b` (the retirement),
`fa1fe32890` (a combo-alias fixture CI caught).

## What changed against the plan

Two reversals, both from audit rather than from build convenience.

The pinned rows in `src/codex/data/upstream-models.json` stayed. The plan called for
deleting them; the A phase found the file is upstream's snapshot by contract
(`metadata.ts:580`) and already carries rows this runtime does not expose (`gpt-5.2`,
`codex-auto-review`). Both maps built from it iterate `NATIVE_OPENAI_MODELS`, so the
rows are unreachable once membership is gone. Deleting ~205 lines would have changed
no behaviour.

The maintainer-facing `docs/` tree was missing from the original scope entirely. The
independent reviewer caught it: `docs/shadow-call-intercept.md` still claimed the
default intercept set was both slugs when the code had been luna-only for a while, and
`docs/codex-app-model-catalog.md` used `gpt-5.4` as a staleness example.

## What CI caught that reading did not

Two defects survived the audit and the six parallel test workers, and were found only
by pushing:

1. `tests/codex-integration/codex-catalog.test.ts` had a native-alias combo fixture
   targeting `codex/gpt-5.4-mini`. Once membership was gone that alias had no native
   capabilities to inherit. `gpt-5.5` carries an identical pinned shape (272k window,
   `low..xhigh`, default `medium`, text and image), so every asserted value held after
   repointing.
2. `enforce-target` fails on any `gui/` path change without screenshot evidence. There
   is no visual change here, so it was waived through the repository's documented
   maintainer-comment mechanism with a note stating exactly what the `gui/src` diff is.

## Verification and its limits

The owner instructed mid-loop that the local suite must not be run on this machine; a
baseline run confirmed why, reporting ~279 failures unrelated to this change. So
`bun run typecheck`, `bun run test`, `bun run structure:check` and the dashboard lint
are **NOT RUN locally**, and the evidence is repository CI against the final head.
`bun run privacy:scan` and `tests/ci-workflows/repo-hygiene.test.ts` were run before
that instruction arrived, on the devlog commit, and both passed.

What this does not prove: nothing here exercised a live ChatGPT account. That the
retired slugs now 404 upstream is the premise of the task, not something this unit
verified.

## What did not improve, and what would falsify this

The `desktop-3p` 1M-native regression lost its positive control. `gpt-5.4` was the only
native with a 1M window, so the test that proved a provider cap can take `supports1m`
away now only proves no native ever gets it. If a 1M native returns, that test should
regain a positive case rather than stay an absence check.

The account-namespaced cleanup question was never settled empirically.
`isUnsupportedOpenAiNativeSlug` returns false for any slug containing `/`, so a
persisted `selector/gpt-5.4` row is not dropped by that predicate; it merely stops
being regenerated. A user who had one on disk is the case that would falsify the claim
that this retirement is self-cleaning.
