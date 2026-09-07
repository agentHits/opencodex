# 010 — wp1 execution log (main lane M + dispatch)

## Dispatch (2026-09-07 ~09:20Z)
Threads created (gpt-6-astra, high): A 01a07b28-06e1-77e3-a323-1e400fd777ca, B 01a07b28-06f3-7cd0-ba8a-c646d4dc5c11,
C 01a07b28-0793-7ff1-abb6-adbbb31d1c72, D 01a07b28-072f-7b93-b840-0f0f16b0ec33, E 01a07b28-06f3-7cd0-ba8a-c62b1f7d1d94.
Ownership amendments accepted during wp1: B owns how-it-works.mdx (en+4) for #3856; i18n is append-only multi-writer;
E owns reference/configuration/providers.md locales for #19; D owns the single modelCosts zero sentence in those files for #3667.

## Main lane M chain (PRs #3865 → #3870)
| Layer | PR | Branch | Head | Source | Notes |
|---|---|---|---|---|---|
| 1 | #3865 | codex/rt-m1-3532 | f1604c6b2 | #3532 Ingwannu | cherry-pick -x, [skip ci] |
| 2 | #3866 | codex/rt-m2-3840 | 98564bdbf | #3840 chilung-cgu | 5 commits squashed (merge commit in source), [skip ci] |
| 3 | #3867 | codex/rt-m3-3837 | 6061dcce0 | #3837 luvs01 | + test isolation fix for discussion_r3945935220 |
| 4 | #3868 | codex/rt-m4-3843 | 00b74c720 | #3843 luvs01 | + same-delta fix for discussion_r3946034145 |
| 5 | #3869 | codex/rt-m5-3845 | 924b65799 | #3845 luvs01 | security review PASS pasted in PR body |
| 6 | #3870 | codex/rt-m6-2033 | 6eadb1658 | #2033 louis-tepe (reimplemented) | top; amended after first top CI |

Independent chain review (astra explorer): PASS, no blockers; security review of #3845 PASS.

Top CI history:
- run 34105730157 @911047281: test 2/4 FAIL — `tests/vision/vision-anthropic.test.ts:342` exact-equality on webSearch body lacked the new `enabled` key (two assertions). Fixed in 6eadb1658 (amend of layer 6). Run cancelled.
- run 34106345180 @6eadb1658 (workflow_dispatch lane=all): queued behind a 60+ run backlog (all lanes dispatching simultaneously). Duplicate pull_request run 34106351272 cancelled.

## Lane status (from wait_threads snapshots)
- A: chain #3879 → #3880 → #3881 published, three-layer source/security audits PASS, top fa9c1ee68 CI queued.
- B: chain #3871 (#3856) → #3872 (#3849); top CI: Linux test 3/4 failure under analysis by lane B.
- C: chain c1…c5 (#3839, #3841, #3863, #3860, #3252) with GUI re-audit PASS; top 8f8ac0d82 CI requested.
- D: #3877 (#3719 ordering) + name-guard layer + price overlay in progress; audits PASS on first two.
- E: #3864 (#18 release.yml) CI in progress with security audit; #19/#20 handoff patches prepared against ece556a6e.

