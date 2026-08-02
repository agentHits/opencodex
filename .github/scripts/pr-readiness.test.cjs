"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { assessReadiness, classifyCheckRuns } = require("./pr-readiness.cjs");

describe("assessReadiness", () => {
  it("keeps failed admission in author-action state", () => {
    assert.deepEqual(
      assessReadiness({ admissionPassed: false }),
      { state: "author_action", failed: ["PR admission"], pending: [] },
    );
  });

  it("keeps PR validating while checks are pending", () => {
    const result = assessReadiness({
      admissionPassed: true,
      statuses: [{ context: "CodeRabbit", state: "pending" }],
      checkRuns: [{ name: "Cross-platform CI", status: "in_progress" }],
    });
    assert.equal(result.state, "validating");
    assert.deepEqual(result.pending.sort(), ["CodeRabbit", "Cross-platform CI"]);
  });

  it("returns author action for failed status or check", () => {
    const result = assessReadiness({
      admissionPassed: true,
      statuses: [{ context: "CodeRabbit", state: "failure" }],
      checkRuns: [{ name: "tests", status: "completed", conclusion: "success" }],
    });
    assert.equal(result.state, "author_action");
    assert.deepEqual(result.failed, ["CodeRabbit"]);
  });

  it("returns maintainer only after every observed check passes", () => {
    const result = assessReadiness({
      admissionPassed: true,
      statuses: [{ context: "CodeRabbit", state: "success" }],
      checkRuns: [
        { name: "tests", status: "completed", conclusion: "success" },
        { name: "docs", status: "completed", conclusion: "skipped" },
      ],
    });
    assert.deepEqual(result, { state: "maintainer", failed: [], pending: [] });
  });

  it("does not claim readiness when no checks were observed", () => {
    assert.equal(
      assessReadiness({ admissionPassed: true }).state,
      "validating",
    );
  });

  it("ignores its own readiness check to avoid recursion", () => {
    const result = assessReadiness({
      admissionPassed: true,
      statuses: [{ context: "CodeRabbit", state: "success" }],
      checkRuns: [
        { name: "PR readiness / reconcile", status: "in_progress" },
      ],
    });
    assert.equal(result.state, "maintainer");
  });
});

describe("classifyCheckRuns", () => {
  it("treats action_required and timed_out as failures", () => {
    const result = classifyCheckRuns([
      { name: "a", status: "completed", conclusion: "action_required" },
      { name: "b", status: "completed", conclusion: "timed_out" },
    ]);
    assert.deepEqual(result.failed, ["a", "b"]);
  });
});
