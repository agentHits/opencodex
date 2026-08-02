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
const IGNORED_NAMES = new Set([
  "PR readiness / reconcile",
  "PR readiness",
]);

function normalizeName(value) {
  return String(value || "").trim();
}

function classifyStatuses(statuses) {
  const pending = [];
  const failed = [];
  let observed = 0;

  for (const status of statuses || []) {
    const name = normalizeName(status.context);
    if (!name || IGNORED_NAMES.has(name)) continue;
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

  for (const check of checkRuns || []) {
    const name = normalizeName(check.name);
    if (!name || IGNORED_NAMES.has(name)) continue;
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

function assessReadiness({ admissionPassed, statuses = [], checkRuns = [] }) {
  if (!admissionPassed) {
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
  BLOCKING_CONCLUSIONS,
  assessReadiness,
  classifyCheckRuns,
  classifyStatuses,
};
