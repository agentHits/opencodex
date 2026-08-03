"use strict";

const IMPLEMENTATION_PREFIXES = [
  "src/",
  "gui/",
  "scripts/",
  "tests/",
  "bin/",
  "packages/",
];

const IMPLEMENTATION_FILES = new Set([
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
]);

const REQUIRED_ATTESTATIONS = [
  "I reviewed every changed line and can explain the implementation.",
  "I ran the validation commands listed above.",
  "Behavior changes include focused regression coverage, or I explained why automated coverage is impossible.",
  "The pull request contains no unrelated cleanup, generated churn, or accidental lockfile changes.",
  "I checked automated-review findings critically instead of applying them blindly.",
  "I will remain available to resolve CI failures and review feedback.",
];

function normalizeCheckboxLabel(value) {
  return value.trim().replace(/\s+/g, " ");
}

function checkedAttestations(body) {
  const checked = new Set();
  const text = typeof body === "string" ? body : "";
  for (const match of text.matchAll(/^\s*[-*+]\s+\[[xX]\]\s+(.+?)\s*$/gm)) {
    checked.add(normalizeCheckboxLabel(match[1]));
  }
  return checked;
}

function missingAttestations(body) {
  const checked = checkedAttestations(body);
  return REQUIRED_ATTESTATIONS.filter((label) => !checked.has(label));
}

function extractLinkedIssueNumbers(body) {
  const text = typeof body === "string" ? body : "";
  const numbers = new Set();

  for (const match of text.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|issue)\s*:?\s*#(\d+)\b/gi,
  )) {
    numbers.add(Number(match[1]));
  }

  return [...numbers];
}

function isImplementationPath(path) {
  if (IMPLEMENTATION_FILES.has(path)) return true;
  return IMPLEMENTATION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function needsApprovedIssue(changedFiles) {
  return changedFiles.some(isImplementationPath);
}

function issueIsApproved(issue) {
  if (issue.state !== "open") return false;
  return issue.labels.some((label) => {
    const name = typeof label === "string" ? label : label?.name;
    return name === "approved-for-work";
  });
}

function assessAdmission({
  body,
  changedFiles,
  linkedIssues,
  authorHasPushPermission = false,
}) {
  const failures = [];
  const missing = missingAttestations(body);

  if (missing.length > 0) {
    failures.push({ code: "missing_attestations", missing });
  }

  if (needsApprovedIssue(changedFiles) && !authorHasPushPermission) {
    if (linkedIssues.length === 0) {
      failures.push({ code: "missing_issue" });
    } else if (!linkedIssues.some(issueIsApproved)) {
      failures.push({
        code: "issue_not_approved",
        issues: linkedIssues.map((issue) => issue.number),
      });
    }
  }

  return failures;
}

module.exports = {
  REQUIRED_ATTESTATIONS,
  assessAdmission,
  checkedAttestations,
  extractLinkedIssueNumbers,
  isImplementationPath,
  issueIsApproved,
  missingAttestations,
  needsApprovedIssue,
};
