"use strict";

const FIRST_TIME_ASSOCIATIONS = new Set([
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "NONE",
]);
const MAX_FIRST_TIME_CHANGED_LINES = 500;
const RESTRICTED_PREFIXES = [
  ".github/workflows/",
  "src/oauth/",
];
const RESTRICTED_FILES = new Set([
  // Release and packaging automation executed by the release workflow.
  "scripts/release.ts",
  "scripts/release-notes.ts",
  "scripts/prepare-package.ts",
  // Authentication, credential, and secret handling. This mirrors the
  // CODEOWNERS security boundary; `src/auth/` does not exist in this repository.
  "src/codex/auth-api.ts",
  "src/codex/auth-collision.ts",
  "src/codex/auth-context.ts",
  "src/cli/account-auth.ts",
  "src/cli/status-oauth.ts",
  "src/lib/admin-secrets.ts",
  "src/lib/service-secrets.ts",
  "src/lib/windows-secret-acl.ts",
  "src/server/auth-cors.ts",
  "src/server/management-api.ts",
  "src/server/management-auth.ts",
  "src/server/management/oauth-account-routes.ts",
  "src/claude/auth-detect.ts",
  "src/claude/auth-mode-migration.ts",
  "src/claude/auth-mode.ts",
  // Dependency surfaces.
  "package.json",
  "bun.lock",
]);
const IMPLEMENTATION_PREFIXES = ["src/", "gui/", "scripts/", "tests/", "bin/", "packages/", ".github/workflows/"];
const IMPLEMENTATION_FILES = new Set(["package.json", "bun.lock", "bunfig.toml", "tsconfig.json"]);

function isFirstTimeContributor(authorAssociation) {
  return FIRST_TIME_ASSOCIATIONS.has(String(authorAssociation || "").toUpperCase());
}

function isImplementationPath(path) {
  return IMPLEMENTATION_FILES.has(path) || IMPLEMENTATION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isRestrictedPath(path) {
  return RESTRICTED_FILES.has(path) || RESTRICTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function changedLines(files) {
  return (files || []).reduce(
    (total, file) => total + Number(file.additions || 0) + Number(file.deletions || 0),
    0,
  );
}

function linkedIssueHasLabel(linkedIssues, labelName) {
  return (linkedIssues || []).some((issue) =>
    issue.state === "open" &&
      (issue.labels || []).some((label) =>
        (typeof label === "string" ? label : label?.name) === labelName,
      ),
  );
}

function assessTrustLane({
  authorAssociation,
  authorHasPushPermission = false,
  files = [],
  changedFiles,
  linkedIssues = [],
  otherOpenImplementationPrs = [],
  currentPr = {},
}) {
  if (authorHasPushPermission || !isFirstTimeContributor(authorAssociation)) return [];
  const paths = changedFiles ?? (files || []).map((file) => file.filename);
  if (!paths.some(isImplementationPath)) return [];

  const failures = [];
  // Keep the oldest open implementation PR eligible and reject only newer
  // ones, so a second PR can never block the author's first submission.
  const candidates = [
    ...(otherOpenImplementationPrs || []).map((pr) => ({
      number: typeof pr === "number" ? pr : pr.number,
      created_at: typeof pr === "number" ? "" : pr.created_at || "",
    })),
    { number: currentPr.number, created_at: currentPr.created_at || "" },
  ].filter((pr) => Number.isInteger(pr.number));
  candidates.sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.number - b.number,
  );
  if (candidates.length > 1 && candidates[0].number !== currentPr.number) {
    failures.push({
      code: "active_pr_limit",
      pullRequests: [candidates[0].number],
    });
  }

  const size = changedLines(files);
  if (
    size > MAX_FIRST_TIME_CHANGED_LINES &&
    !linkedIssueHasLabel(linkedIssues, "large-change-approved")
  ) {
    failures.push({
      code: "first_pr_too_large",
      changedLines: size,
      maximum: MAX_FIRST_TIME_CHANGED_LINES,
    });
  }

  const restricted = paths.filter(isRestrictedPath);
  if (
    restricted.length > 0 &&
    !linkedIssueHasLabel(linkedIssues, "maintainer-sponsored")
  ) {
    failures.push({ code: "restricted_surface", paths: restricted });
  }

  return failures;
}

module.exports = {
  MAX_FIRST_TIME_CHANGED_LINES,
  assessTrustLane,
  changedLines,
  isFirstTimeContributor,
  isImplementationPath,
  isRestrictedPath,
  linkedIssueHasLabel,
};
