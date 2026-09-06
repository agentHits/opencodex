# Check-phase cumulative deadline fixture repair

CI34016017020 passed Kiro checks but macOS1 failed an unrelated elapsed <500ms
assertion (644ms) in web-search-timeout-contract.test.ts. The contract uses a
45ms response-header deadline; the wall measurement also includes preparation
and host scheduling. Source still starts one deadline before the rotation loop
and does not await the first response body's cancellation promise.

Modify only that test file. For this one cancellation/rotation case, spy on the
existing clearableDeadline export and provide a controlled original deadline.
Hold the body-cancel promise until fixture cleanup; let the rotated fetch record
that cancellation is still pending and that it receives the same signal, then
expire that original deadline explicitly. Assert one deadline factory call,
one real rotated fetch, cancellation/rotation/expiry ordering, cleanup and the
same exact504 response. Keep the existing1000ms test timeout unchanged.

The real-timer header-timeout and abort-library tests stay unchanged. The fixture
tests deadline ownership and nonblocking cancellation rather than a loaded host's
wall time. Restore the spy and release/abort controlled resources in both finally
and afterEach, including a failing or timed-out test. No production timeout,
retry, skip or local suite is introduced. Verify by independent review and fresh
hosted CI in a separate prerequisite test-only PR beneath Kiro.
