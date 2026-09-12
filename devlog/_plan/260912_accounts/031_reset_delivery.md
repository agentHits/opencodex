# Reset-first carry follows the current pool contract

Adapts #4080 ecf6b4e48a4c2992c296fada2caf6a8132313eaa by Terry Tan. The Codex parser now lives in the existing shared kernel leaf, canonical and legacy settings round-trip the configured strategy, and the GUI offers it only on Codex. Existing runtime priority, manual preference and cache-affinity behavior is preserved. Mixed reset units are normalized before ordering; independent model quota scopes retain existing quota selection.

Regression sources include original reset-first cases plus mixed units, cacheAffinity on/off, scoped fallback/health/shared cursor, canonical and legacy persistence, non-Codex rejection and GUI empty-response normalization. UI hints reflect current cache-affinity and scope semantics. Local tests/build/typecheck/install: NOT RUN. git diff --check is whitespace evidence only; independent source review and hosted final-tip CI/render evidence follow.

Source search: accountPoolStrategy, normalizeAccountPoolStrategy, resetAtToMs, pool/settings, mayRebindAffinityForQuota, manualPreferenceBlocks and all strategy consumers. Existing pool-kernel and routing owners extended; no new dependency or separate pool implementation. Config passthrough behavior preserved deliberately; write routes validate through the Codex-specific parser.

Co-authored-by: Terry Tan <tmy1995hflc@gmail.com>
