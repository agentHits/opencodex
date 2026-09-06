# Dashboard alignment carry

Depends on integrated runtime for final presentation; independent PR, class C2. Carry #3697 head 49a9c79392babd9413831437d6ad71839737b148 (base cededd5ad1b8f8c437813c315c0705ace6c950c3), preserving Co-authored-by: Robin Bially <7304732+RobinBially@users.noreply.github.com>. #3689 authless-default change is outside this train.

## Exact change map

- MODIFY gui/src/styles-dashboard-workspace.css: shared label/control columns, --dash-controls-width around 26rem, container-based collapse, full-width delegation/sync rows.
- MODIFY gui/src/styles.css: consistent status card alignment and responsive version badge behavior.
- MODIFY gui/src/pages/dashboard-overview-head.tsx and dashboard-overview-sections.tsx: carry original layout classes only; preserve all handlers, state and new controls from current dev.
- MODIFY gui/src/App.tsx: sidebar/mobile version width yields to product name and retains full-value hover.
- MODIFY gui/tests/mobile-topbar-layout.test.ts: version flex-shrink and stable small-layout contract.
- MODIFY docs-site/src/content/docs/guides/web-dashboard.md; ADD original screenshot docs/pr-assets/dashboard-settings-aligned.jpg only as supplied by source PR, mark its source/version clearly. Capture updated screenshot if final rendered content differs.

Before: uneven columns, two-up tool cards squeeze controls, version text can take product space. After: wide single label/control grid; narrow stacks preserve reading order and 320px selector fit. No visible strings added; any necessary additions require all locale modules.

## Acceptance / verifier

Remote GUI lint/stylelint, GUI tests and Vite build from ci.yml; verify rendered wide/narrow state using existing browser tooling with CI-built/static artifact when available (no local suite/build). Inspect original screenshot at exact source SHA and do not claim it proves later changed content. New screenshots must show final UI, with no account info. Regression test alone is not visual proof; independently inspect UI screenshot and CSS breakpoints.

## Limits

No authless setting, quota semantics or model management expansion. Preserve current state labels and accessibility. P rechecks any intervening same-file changes before carrying.


## Hosted artifact verification

Main owns the eight-file attributed carry; no handler or visible-copy changes. Add one bounded preview artifact to the existing ci.yml gates job after its existing GUI build, only when changes.outputs.gui is true. Pin actions/upload-artifact v7.0.1 to043fb46d1a93c77aae656e7c1c64a875d1fc6a0a (verified official repository tag/release). Include only gui/dist, with generated build-commit.txt and build-gui-tree.txt; retention7days and missing-fileserror. No trigger, token permission, secret, checkout or release change. Workflow surface raises this unit to C4 and gets independent security review.

The artifact identifies the actual checkout and gui tree: PR CI may build a merge ref. Compare build-gui-tree against final reviewed head:gui before claiming final UI proof. Download that artifact, serve the built frontend with an isolated fixture API in scratch (no real provider, account, or service mutation), and use the existing browser runtime for1440/1024/768/390/320px and keyboard/focus/overflow observation. No local build/typecheck/test suite. Public screenshots use synthetic data only; the source PR jpg is a reference, not final-head evidence.

Maintain manual dependent PR publication after the owner's explicit native-stack removal. AsyncCI/admin integration of3762/3763 is delegated; no local rebase. Await artifact only for visual C, not for unrelated bookkeeping. HostedCI handles lint/typecheck/tests/build/privacy. Escalate only an actual permission or unavailable artifact boundary; no invented local fallback. No user token/cost cap; each tooling run bounded30minutes, individual waits <=60seconds; main retains complete release goal.
