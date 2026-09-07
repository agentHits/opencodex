# 030 Account price identity
MODIFY src/usage/user-cost-overlays.ts registry refresh and signature/version.
Before: configured provider set and overlay rows only.
After: exact account identifiers/log labels from config mapped to established provider
identity. Include mapping in signature for memo and aggregate cache invalidation.
MODIFY src/usage/cost.ts resolveMatchedPrice: exact configured namespace and exact
user overlay precede account identity; unresolved suffix is never guessed/stripped.
MODIFY tests/usage/usage-cost.test.ts or existing provider-overlay tests: custom account
id, qualified id, stable log label, configured collision, unrelated hyphenated provider,
account rename/removal invalidation. Account aliases never become identity authority.
Audit determines precise supported historical labels from actual producer evidence.

Verification: NOT RUN locally by user instruction; focused tests execute in final top-head Cross-platform CI.
