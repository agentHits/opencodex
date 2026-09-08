# Candidate verification and landing ledger

## Verified candidates before final integration

| Source | Owned PR | Candidate head | Successful PR CI |
| --- | --- | --- | --- |
| #3838 placement/stateless residual | #3986 | d1f61e933b0cde3df3862baed65546a5cf81066f | 34178540141 |
| #3907 string child-result residual | #3991 | 00eb47886690e7b24b0eed69b6d870c33ceade62 | 34180674115 |
| #3944 V2 guidance | #3992 | 3ceef0121712b290c3d4443e9fc3f0a04cecead6 | 34181398746; target check rerun 34181398713 |
| #3951 server-owned preset | #3993 | 727683f44e9f1daa9b6b1e2dbf93167e4ce30cc1 | 34185870948 |
| #3965 canonical alias | independently merged | 62412d38606851f7cace76360f3c5737db9cae20 | 34181771859; merge 402be7c1f88283eb8465c3aec8437ccecd2542ec |
| #3973 / #3995 recovery consolidation | #4002 | 6904ecd9cdbbd6b393e32f5e4c393a705eb3a0d2 | 34188893148 |

Each new candidate received independent source review; authentication/recovery changes also received explicit source security review. C6's two initial publication/lineage findings were repaired before adoption. The failed test-budget fixture retained its expected response/replay assertions and gained proper per-test isolation; the repaired negative reached actual external-replacement provenance in hosted execution. No local product suites, install, typecheck or build were run.

PR CI skips the full Windows and macOS-control jobs by workflow design; these rows are not evidence those jobs passed. The final pinned `lane=all` dispatch remains mandatory before landing.

## GUI and documentation

The preset GUI tree is `b0bc09ba867906375e52cf0180caa4ea4ea95bea`. Hosted artifact 10039810403 from run 34183701289 supplied the rendered bundle. Main and two independent reviewers inspected desktop light/dark and Korean 320/390px captures; viewport metrics also cover 768/1024px. The narrow editor layout was repaired after observing clipping. Exact custom saving, restore-without-write, clear, missing/malformed recommendations, error/retry, a distinct server recommendation, and keyboard focus were exercised against an isolated synthetic API. No real account or native configuration was used.

Screenshot-only evidence commit: `924327cdd71a14a0aea1936e4c5e1f6b6b660438`. Its immutable images are linked in #3993. The image branch is not another product PR. GUI source and artifact bytes remain the same after the subsequent test-only correction. Owned browser/fixture ports 9239 and 18744 were verified closed.

Documentation builds ran only in an isolated `macmini-cf` scratch directory using Bun 1.4.0 and Node 24.20.0. The latest candidate build produced 425 pages; the CLI management link and Korean reset contract were checked in generated HTML. An initial incomplete-transfer attempt is excluded from passing evidence. No documentation deployment occurred.

## Final integration plan and pending evidence

Pin dev `402be7c1f88283eb8465c3aec8437ccecd2542ec` and merge it into the top candidate. The two preview conflicts are duplicate canonical-alias prefixes in the English management reference and auth API tests. Dev's versions equal the already-adopted alias predecessor, so retaining the complete candidate versions preserves both that contribution and recovery additions. Other incoming dev changes remain intact. Existing user-file paths have no overlap with the incoming dev delta.

Before each ordinary merge, refresh actor permission, head/base, native membership, reviewer objections and checks. Use merge commits and retarget children bottom-up. Final full-matrix run, actual merge SHAs, source closures, and tree/ancestry proof will be appended after those actions occur; none is claimed by this planning snapshot.

Attribution retained: jpierrevd for #3838 intent; luvs01 for #3944/#3951/#3919/#3965 and adapted #3995 coverage/documentation. Lossy mixed-ciphertext filtering from #3838 is deliberately declined; current fail-closed behavior remains. #3997/#3996 is independent and stays outside this delivery.

## Integrated candidate and failed full dispatch

Integration commit `f1b436324d335a64789e7899a4ed491183a9c216` retains all incoming dev changes. The independently inspected resolution matched predicted tree `4e1a2458e243da43a32d49664364e88d3473da32` before the three delivery-record updates; all 30 pre-existing user files remained unchanged. PR CI `34190212954` passed. Full dispatch `34190287787` completed with 24 successful jobs, one failed Windows3/6 test job and a failed aggregate. The failure was the first `restart --help` test's null subprocess status at its fixed10s synchronous bound; later help cases passed. This failed run is not landing evidence.

The final docs archive from this integrated head has SHA-256 `a51cdbd83f409472defcb7758873734edba167f116a17869ec345366e0e9063d`. Remote frozen install and build passed with 425 pages; the rendered CLI recovery link resolves to the API section, and English/Korean reset replay text is present.

The audited repair is confined to the CLI test harness, preserving all original command assertions and private homes while making exit, termination and capture failures explicit. A fresh exact-head full dispatch remains required after the repair. Neither a historical root cause nor absence of future timing failures is claimed.
