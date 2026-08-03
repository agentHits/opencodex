"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  admissionCheckPending,
  assessReadiness,
  classifyCheckRuns,
  classifyStatuses,
  latestByCheckName,
} = require("./pr-readiness.cjs");

describe("assessReadiness", () => {
  it("keeps failed admission in author-action state", () => {
    assert.deepEqual(
      assessReadiness({ admissionPassed: false }),
      { state: "author_action", failed: ["PR admission"], pending: [] },
    );
  });

  it("keeps PR validating while the admission check is still running", () => {
    const result = assessReadiness({
      admissionPassed: false,
      checkRuns: [{ name: "PR admission / admission", status: "in_progress" }],
    });
    assert.equal(result.state, "validating");
    assert.deepEqual(result.pending, ["PR admission"]);
  });

  it("recognizes a pending admission check by its job name", () => {
    const result = assessReadiness({
      admissionPassed: false,
      checkRuns: [{ name: "admission", status: "in_progress" }],
    });
    assert.equal(result.state, "validating");
    assert.equal(admissionCheckPending([{ name: "admission", status: "in_progress" }]), true);
  });

  it("returns author action when admission completed with a failure", () => {
    const result = assessReadiness({
      admissionPassed: false,
      checkRuns: [
        { name: "PR admission / admission", status: "completed", conclusion: "failure" },
      ],
    });
    assert.equal(result.state, "author_action");
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

  it("does not treat a successful admission run as post-admission evidence", () => {
    const result = assessReadiness({
      admissionPassed: true,
      checkRuns: [{ name: "admission", status: "completed", conclusion: "success" }],
    });
    assert.equal(result.state, "validating");
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

  it("ignores the reconcile job by its actual check-run name", () => {
    const result = assessReadiness({
      admissionPassed: true,
      statuses: [{ context: "CodeRabbit", state: "success" }],
      checkRuns: [
        { name: "reconcile", status: "in_progress" },
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

  it("keeps only the newest run per check name", () => {
    const result = classifyCheckRuns([
      { name: "Cross-platform CI", status: "completed", conclusion: "failure", started_at: "2026-08-01T00:00:00Z" },
      { name: "Cross-platform CI", status: "completed", conclusion: "success", started_at: "2026-08-02T00:00:00Z" },
    ]);
    assert.equal(result.observed, 1);
    assert.deepEqual(result.failed, []);
  });

  it("ignores admission runs in readiness evidence", () => {
    const result = classifyCheckRuns([
      { name: "admission", status: "completed", conclusion: "success" },
    ]);
    assert.equal(result.observed, 0);
  });
});

describe("latestByCheckName", () => {
  it("picks the newest run when started_at is present", () => {
    const runs = latestByCheckName([
      { name: "a", started_at: "2026-08-01T00:00:00Z" },
      { name: "a", started_at: "2026-08-02T00:00:00Z" },
      { name: "b", started_at: "2026-08-01T00:00:00Z" },
    ]);
    assert.deepEqual(
      runs.map((r) => r.started_at).sort(),
      ["2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"],
    );
  });
});

describe("classifyStatuses", () => {
  it("ignores readiness and admission status contexts", () => {
    const result = classifyStatuses([
      { context: "CodeRabbit", state: "success" },
      { context: "reconcile", state: "pending" },
      { context: "admission", state: "failure" },
    ]);
    assert.equal(result.observed, 1);
    assert.deepEqual(result.failed, []);
  });
});

describe("admissionCheckPending", () => {
  it("treats an in-progress admission check as pending", () => {
    assert.equal(
      admissionCheckPending([
        { name: "PR admission / admission", status: "in_progress" },
      ]),
      true,
    );
  });

  it("treats a completed admission check as not pending", () => {
    assert.equal(
      admissionCheckPending([
        { name: "PR admission / admission", status: "completed", conclusion: "failure" },
      ]),
      false,
    );
  });

  it("is false when no admission check is present", () => {
    assert.equal(admissionCheckPending([]), false);
  });
});
