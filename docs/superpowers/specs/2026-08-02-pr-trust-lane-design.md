# New-contributor trust lane — Design

**Stack:** 3/5, based on `agent/pr-readiness-gate`

First-time contributors get a deliberately narrow lane until the repository has evidence that they can scope, validate, and maintain their submissions.

- One active implementation PR per first-time author.
- Maximum 500 changed lines for a first implementation PR unless the linked issue has `large-change-approved`.
- Workflow, OAuth/authentication, release, and dependency surfaces require `maintainer-sponsored` on the linked issue.
- Documentation-only work, established contributors, and repository collaborators are exempt.

The workflow uses PR metadata and GitHub APIs only. It does not inspect whether code was written by AI and does not execute untrusted code.
