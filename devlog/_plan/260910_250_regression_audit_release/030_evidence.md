# Evidence ledger

Filled as the cycles complete. Every row names the source of the claim.

## Frozen facts

| Item | Value | Source |
| --- | --- | --- |
| Released baseline | `v2.49.0` / `main` `2f3f736299dca38861f8fb9c4326a4b4d7c664bc` | `git log origin/main` |
| Audit candidate | `dev` `12c248f52bed88ea13be5b284c79a238feb592d1` | `git rev-parse origin/dev` |
| Candidate version | `2.50.0` | `package.json` |
| Product delta | 121 files, +3322 / -280 | `git diff --shortstat 2f3f73629...origin/dev -- src gui docs-site scripts .github` |

## Audit findings

| ID | Lane | File:line | Failure mode | Blocker | Disposition |
| --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | |

## Release artifacts

| Gate | Evidence | Status |
| --- | --- | --- |
| Cross-platform CI on release SHA | | pending |
| Service lifecycle on release SHA | | pending |
| `dev` pre-move | | pending |
| `preview` promotion | | pending |
| `main` promotion | | pending |
| npm `latest` = 2.50.0 | | pending |
| `gitHead` matches promoted `main` | | pending |
| git tag + GitHub release | | pending |
