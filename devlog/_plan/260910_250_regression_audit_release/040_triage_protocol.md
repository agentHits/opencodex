# Triage and remediation protocol (wp3)

wp2 returns six lane reports. This is how they become a release decision.

## 1. Normalize

Each lane return is split into individual findings. A finding is only admitted with an
exact `path:line` anchor or a literal command and its output. An unanchored assertion is
recorded as **unsubstantiated** and re-derived by the main session or dropped; it never
blocks and it never passes silently.

Findings from different lanes that name the same defect are merged, keeping every anchor.

## 2. Classify

Apply the eight-clause blocker definition in `010_audit_lanes.md`. Each finding gets
exactly one disposition.

| Disposition | Meaning | Action |
| --- | --- | --- |
| `BLOCK` | Matches a blocker clause | Must be fixed and landed on `dev` before promotion |
| `SHIP` | Real but does not match a clause | Recorded here, filed as an issue if it deserves one, released as is |
| `PRE-EXISTING` | Present in `2f3f73629` as well | Not this release's problem; prove it with a command against the released tree |
| `WRONG` | The lane misread the code | Rebutted with the anchor that disproves it |

A finding is `PRE-EXISTING` only with proof: `git show 2f3f73629:<path>` showing the same
defect, or a test that fails on the baseline. "It looks old" is not proof.

## 3. Remediate

Every `BLOCK` fix follows the repository's normal contribution path — a branch off the
current `dev`, a focused regression test next to the existing tests for that subsystem,
a pull request against `dev` using `.github/PULL_REQUEST_TEMPLATE.md`, and the exact-head
CI evidence the branch policy requires. No direct push to `dev`; the ruleset rejects it
regardless of `--no-verify`.

Landing a fix **moves the candidate**. When that happens:

1. Record the new `dev` SHA as the freeze SHA, superseding `12c248f52`.
2. Re-run the candidate-tree CI dispatch on the new SHA. Green on the old head proves
   nothing about the new one.
3. Re-run only the lanes whose read scope intersects the fix, not all six.

## 4. Escalate rather than weaken

If a `BLOCK` cannot be fixed inside this scope — it needs a design decision, an external
credential, or a change the user has not authorized — the release stops and the outcome is
`BLOCKED`. Reclassifying a blocker to `SHIP` to reach a release is the one move this
protocol forbids. The alternative that *is* allowed: revert the offending commit range from
the candidate and release without that feature, which is a smaller change than shipping a
known defect.

## 5. Record

Every finding lands in the wp2 findings table in `030_evidence.md` with its ID, lane,
anchor, failure mode, disposition, and — for `BLOCK` — the PR and merge SHA that resolved
it. A finding with no row in that table did not happen.
