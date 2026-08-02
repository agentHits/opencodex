# Review lifecycle and governance rollout — Design

**Stack:** 5/5, based on `agent/pr-hygiene-gate`

This layer closes the policy gaps that automation alone cannot solve.

- A substantial review round is one maintainer `CHANGES_REQUESTED` review with at least 40 characters of actionable text on a distinct head SHA.
- Multiple reviews of the same revision count as one round.
- After two rounds, automation applies `review: limit-reached`; it does not close automatically.
- Maintainers may close when architectural repair is still required, defects recur, or the author cannot own the implementation.
- Standard closure labels make dispositions consistent and measurable.
- Contributor policy explicitly assigns branch repair, CI failures, and review fixes to the author.
- CODEOWNERS expands review routing for adapters, providers, Codex integration, and server behavior while keeping authentication and automation under the stricter existing owners.
- Repository rulesets and merge queue remain an owner/admin action documented in an exact rollout checklist.
