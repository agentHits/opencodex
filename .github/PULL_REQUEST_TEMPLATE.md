## Summary

Explain the user-visible or maintainer-facing change and why this approach is appropriate.

## Linked issue

Closes #<!-- issue number -->

Implementation pull requests must reference an issue labeled `approved-for-work`. Documentation-only and maintainer-owned integration changes are exempt.

## Verification

List the exact commands or checks you ran and their results. Do not write only "tested" or "CI".

```text
bun run typecheck
bun run test
```

## Regression coverage

Name the test that fails without this change and passes with it. If automated coverage is genuinely impossible, explain why and describe the manual evidence.

## Screenshots or recordings

Required for user-visible dashboard changes. Remove this section when it does not apply.

## Author responsibility

- [ ] I reviewed every changed line and can explain the implementation.
- [ ] I ran the validation commands listed above.
- [ ] Behavior changes include focused regression coverage, or I explained why automated coverage is impossible.
- [ ] The pull request contains no unrelated cleanup, generated churn, or accidental lockfile changes.
- [ ] I checked automated-review findings critically instead of applying them blindly.
- [ ] I will remain available to resolve CI failures and review feedback.
