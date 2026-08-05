# 130 — Dispositions (closes and verdicts with evidence)

User authorization on record: close issues/PRs that are already resolved on
`dev`. Anything beyond that (closing contributor PRs as superseded, asking
reporters for info) is executed only when this document's table names it, and
ambiguous cases go back to the user first.

## Close as already-fixed (issue)

| Item | Action | Evidence to cite in the close comment |
|------|--------|----------------------------------------|
| #806 | **closed 2026-08-05** | `d52b387db` is an ancestor of `origin/dev` (verified `git merge-base --is-ancestor`); GUI/CLI/docs wording split shipped (`gui/src/i18n/en.ts:1296-1315`) |

## Campaign output map (2026-08-05)

| Issue | Successor PR | Landed on `dev` |
|------:|--------------|-----------------|
| (400 incident) | #1020 | `ab5b20ca4` |
| #914 | #1023 | `af100ec93` |
| #893 | #1025 | `064686b41` |
| #875 | #1026 | `c1e9a204b` |
| #938 | #1027 | `2d7aa907c` |
| #992 | #1028 | `02dbcff9c` |
| #1007 | #1029 | `cc10b3fe9` |
| #1001 | #1030 | `79f0fa508` |
| #907 | #1031 | `27efe1940` (+ jawcode `63aefba` pushed to `codex/gpt-5.6-price-cut-refresh`) |
| #993 | #1032 | see 140 |
| #959 | #1033 | `51c4be686` (adopted #961; #961 closed manually) |
| (review follow-up) | #1038 | `4cfdc7168` |
| (review follow-up) | #1040 | `391291013` |

`#1032` landed as `dddc674ca`. All thirteen campaign PRs are merged and every
merge commit is an ancestor of `origin/dev`.

Both follow-ups came out of adversarial review of the merged stack. #1038
closed the first round of redaction and lifecycle-identity gaps. #1040 ran
fifteen further rounds against `redactSecretString`, where every round found a
credential hidden inside whatever the previous round had chosen to preserve —
a quoted value, a delimiter, a closing tag, a multipart boundary, a serialized
sibling. The fix that held was to stop preserving anything: a credential value
now runs to a boundary the input cannot move, in every framing.

The residual there — confusable coverage is a hand-maintained table rather
than a UTS #39 skeleton — is recorded as a DRAFT SECURITY ADVISORY rather than
a public issue, because it describes a redaction weakness rather than a
shipped fix: `GHSA-8ffg-jp74-rmm2`. Reachability is low and is analyzed there.

Full closeout record, including the two audit rounds that produced #1038:
`140_closeout_supersede_and_merge.md`.

## Verification-needed issues — campaign verdicts

| Item | Disposition | Basis |
|------|-------------|-------|
| #994 | leave open; allowlist location identified, needs reporter's provider/model + wire capture | `src/providers/registry.ts:918-958,1637-1655` |
| #904 | leave open; `eeef7a32a` fixed surrogate boundaries but the original capture is still needed | 001 triage |
| #796 | leave open pending live Ark credential verification; structural fix `d3abf4345` + regression test already on dev | `tests/volcengine-ark-assistant-content.test.ts:90-125` |
| #418 | leave open; latest same-run trace does not reproduce; needs reporter's current trace | `src/server/responses/collaboration.ts:243-304` |

## Contributor PRs superseded by stack PRs

Disposition happens only after the corresponding stack PR lands on `dev`,
and only after a semantic-equivalence comparison (audit round 1, blocker 5):
the landed behavior and tests are compared against the contributor PR's full
scope, useful authorship is preserved where the contributor's approach was
adopted, and any contributor behavior intentionally not matched is recorded
with the reason. "The linked issue is fixed" alone is never sufficient.

| PR | Successor | Equivalence basis (from the decade docs) | Disposition when landed |
|---:|-----------|------------------------------------------|-------------------------|
| #966, #922 | 030 (#914) | #966 closest semantic source (classifier/retry extracted, sidecar blast radius excluded); #922 not equivalent (policy expansions rejected) | **closed 2026-08-05** |
| #928 | 040 (#893) | field-only normalization ≠ commitment; event-synthesis design recorded | **closed 2026-08-05** |
| #940 | 060 (#938) | ID-prefix idea equivalent; the rest of the bundle deliberately excluded, named in the close comment | **closed 2026-08-05** |
| #1006 | 050 (#875) | core policy adopted (bounded upstream JSON), diff superseded with attribution | **closed 2026-08-05** |
| #961 | 120 (#959) | ADOPTED, not superseded — authorship preserved (`71ac00af8f82`, `e56dfbdc1bc8`), hardening slice added | **closed 2026-08-05 after #1033 landed** — manually, since a closing keyword does not close a PR |

All five closes were made BEFORE their successors landed, on the user's
instruction, and each comment said so explicitly: successor number, its audited
head SHA, and the statement that it was open and unmerged with revalidation
pending. Every successor subsequently landed, so no reopen was needed.

## Stale/broken PRs outside the stack

#933 (CI fail), #557 (CI fail), #936 (conflicting, needs security review per
MAINTAINERS), #569 (conflicting), #997/#947/#1000/#978/#983/#985 (unverified,
policy-only CI). These stay open; the campaign does not close contributor work
that merely needs the author. Recorded here so the surface state is complete.
