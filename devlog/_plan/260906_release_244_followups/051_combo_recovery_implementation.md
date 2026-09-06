# Mixed combo recovery implementation

The carry changes only combo selection in core and provider usability in the
combo resolver. A selectable native target keeps priority. If native candidates
are unavailable or exhausted, an available routed target may be selected after
one explicitly enabled encrypted-task recovery. Existing caller admission,
fixed recovery backend, attempt exclusions and plaintext no-persistence remain.

Canonical native quota belongs to account/model selection; cached summaries keep
filtering third-party and noncanonical providers. Both initial and late recovery
failures recheck caller cancellation, including cancellation during target waiting,
before returning an unreadable-task or prior native error.

Original contributor tests cover disabled/cooldown/native-401, failed recovery,
unavailable targets, canonical/noncanonical quota and eligibility. The new paired
abort fixture waits for the recovery fetch to start, then cancels its actual signal;
499/client_cancelled, no routed call and empty cache/continuation stores are asserted.
No local suites/typecheck/build or live Kiro request are used. Hosted exact-head CI
and independent source/security/final reviews supply integration evidence.
