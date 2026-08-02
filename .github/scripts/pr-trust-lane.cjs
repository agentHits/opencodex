"use strict";

const FIRST_TIME_ASSOCIATIONS = new Set([
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "NONE",
]);
const MAX_FIRST_TIME_CHANGED_LINES = 500;
const RESTRICTED_PREFIXES = [
  ".github/workflows/",
  "src/auth/",
  "src/oauth/",
];
const RESTRICTED_FILES = new Set([
  "scripts/release.ts",
  "package.json",
  "bun.lock",
]);
const IMPLEMENTATION_PREFIXES = ["src/", "gui/", "scripts/", "tests/", "bin/", "packages/", ".github/workflows/"];
const IMPLEMENTATION_FILES = new Set(["package.json", "bun.lock", "tsconfig.json"]);

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
    (issue.labels || []).some((label) =>
      (typeof label === "string" ? label : label?.name) === labelName,
    ),
  );
}

function assessTrustLane({
  authorAssociation,
  authorHasPushPermission = false,
  files = [],
  linkedIssues = [],
  otherOpenImplementationPrs = [],
}) {
  if (authorHasPushPermission || !isFirstTimeContributor(authorAssociation)) return [];
  if (!files.some((file) => isImplementationPath(file.filename))) return [];

  const failures = [];
  if (otherOpenImplementationPrs.length > 0) {
    failures.push({
      code: "active_pr_limit",
      pullRequests: otherOpenImplementationPrs,
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

  const restricted = files
    .map((file) => file.filename)
    .filter(isRestrictedPath);
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
