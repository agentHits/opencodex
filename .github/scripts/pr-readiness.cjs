"use strict";

const ACCEPTABLE_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const BLOCKING_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);
// GitHub Actions reports the job name as the check-run name, so the reconcile
// job's own runs surface as "reconcile". Both the display and job-name forms
// are matched so an in-progress reconcile run can never block readiness.
const IGNORED_NAMES = new Set([
  "reconcile",
  "PR readiness / reconcile",
  "PR readiness",
]);
// Admission state is conveyed by the `intake: admitted` label; admission check
// runs must not count as post-admission evidence, or a PR whose only check is
// a successful admission run would be declared maintainer-ready before
// CodeRabbit or CI ever report.
const ADMISSION_NAMES = new Set([
  "admission",
  "PR admission / admission",
]);

function normalizeName(value) {
  return String(value || "").trim();
}

function isManagedCheckName(name) {
  return IGNORED_NAMES.has(name) || ADMISSION_NAMES.has(name);
}

// The Checks API's `latest` filter returns the newest run per check suite, not
// per check name, so repeated invocations on an unchanged head SHA coexist.
// Keep only the newest run per check name before classifying.
function latestByCheckName(checkRuns) {
  const latest = new Map();
  for (const check of checkRuns || []) {
    const name = normalizeName(check.name);
    if (!name) continue;
    const existing = latest.get(name);
    if (
      !existing ||
      String(check.started_at || "") >= String(existing.started_at || "")
    ) {
      latest.set(name, check);
    }
  }
  return [...latest.values()];
}

function classifyStatuses(statuses) {
  const pending = [];
  const failed = [];
  let observed = 0;

  for (const status of statuses || []) {
    const name = normalizeName(status.context);
    if (!name || isManagedCheckName(name)) continue;
    observed += 1;
    if (status.state === "pending") pending.push(name);
    else if (status.state !== "success") failed.push(name);
  }

  return { pending, failed, observed };
}

function classifyCheckRuns(checkRuns) {
  const pending = [];
  const failed = [];
  let observed = 0;

  for (const check of latestByCheckName(checkRuns)) {
    const name = normalizeName(check.name);
    if (!name || isManagedCheckName(name)) continue;
    observed += 1;
    if (check.status !== "completed") {
      pending.push(name);
      continue;
    }
    const conclusion = check.conclusion || "";
    if (BLOCKING_CONCLUSIONS.has(conclusion)) failed.push(name);
    else if (!ACCEPTABLE_CONCLUSIONS.has(conclusion)) pending.push(name);
  }

  return { pending, failed, observed };
}

function admissionCheckPending(checkRuns) {
  const admission = latestByCheckName(checkRuns).find(
    (check) => ADMISSION_NAMES.has(normalizeName(check.name)),
  );
  return Boolean(admission && admission.status !== "completed");
}

function assessReadiness({ admissionPassed, statuses = [], checkRuns = [] }) {
  if (!admissionPassed) {
    if (admissionCheckPending(checkRuns)) {
      return {
        state: "validating",
        failed: [],
        pending: ["PR admission"],
      };
    }
    return {
      state: "author_action",
      failed: ["PR admission"],
      pending: [],
    };
  }

  const statusResult = classifyStatuses(statuses);
  const checkResult = classifyCheckRuns(checkRuns);
  const failed = [...new Set([...statusResult.failed, ...checkResult.failed])];
  const pending = [...new Set([...statusResult.pending, ...checkResult.pending])];
  const observed = statusResult.observed + checkResult.observed;

  if (failed.length > 0) return { state: "author_action", failed, pending };
  if (pending.length > 0 || observed === 0) {
    return { state: "validating", failed: [], pending };
  }
  return { state: "maintainer", failed: [], pending: [] };
}

module.exports = {
  ACCEPTABLE_CONCLUSIONS,
  ADMISSION_NAMES,
  BLOCKING_CONCLUSIONS,
  admissionCheckPending,
  assessReadiness,
  classifyCheckRuns,
  classifyStatuses,
  latestByCheckName,
};
