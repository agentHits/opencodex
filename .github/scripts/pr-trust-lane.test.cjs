"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_FIRST_TIME_CHANGED_LINES,
  assessTrustLane,
  isFirstTimeContributor,
  isImplementationPath,
  isRestrictedPath,
} = require("./pr-trust-lane.cjs");

describe("first-time classification", () => {
  it("classifies GitHub first-time associations", () => {
    assert.equal(isFirstTimeContributor("FIRST_TIMER"), true);
    assert.equal(isFirstTimeContributor("FIRST_TIME_CONTRIBUTOR"), true);
    assert.equal(isFirstTimeContributor("NONE"), true);
    assert.equal(isFirstTimeContributor("CONTRIBUTOR"), false);
  });

  it("recognizes restricted security and dependency surfaces", () => {
    assert.equal(isRestrictedPath(".github/workflows/ci.yml"), true);
    assert.equal(isRestrictedPath("src/oauth/provider.ts"), true);
    assert.equal(isRestrictedPath("package.json"), true);
    assert.equal(isRestrictedPath("src/router.ts"), false);
  });

  it("classifies bunfig.toml as an implementation file", () => {
    assert.equal(isImplementationPath("bunfig.toml"), true);
  });
});

describe("assessTrustLane", () => {
  const smallRuntimeChange = [{ filename: "src/router.ts", additions: 40, deletions: 5 }];

  it("limits first-time authors to one active implementation PR", () => {
    const failures = assessTrustLane({
      authorAssociation: "FIRST_TIME_CONTRIBUTOR",
      files: smallRuntimeChange,
      otherOpenImplementationPrs: [812],
    });
    assert.deepEqual(failures[0], { code: "active_pr_limit", pullRequests: [812] });
  });

  it("rejects oversized first implementation PRs without approval", () => {
    const failures = assessTrustLane({
      authorAssociation: "FIRST_TIMER",
      files: [{ filename: "src/router.ts", additions: MAX_FIRST_TIME_CHANGED_LINES + 1, deletions: 0 }],
    });
    assert.equal(failures[0].code, "first_pr_too_large");
  });

  it("allows oversized work when the linked issue approves it", () => {
    const failures = assessTrustLane({
      authorAssociation: "FIRST_TIMER",
      files: [{ filename: "src/router.ts", additions: 700, deletions: 0 }],
      linkedIssues: [{ labels: [{ name: "large-change-approved" }], state: "open" }],
    });
    assert.deepEqual(failures, []);
  });

  it("rejects approval labels on closed issues", () => {
    const failures = assessTrustLane({
      authorAssociation: "FIRST_TIMER",
      files: [{ filename: "src/router.ts", additions: 700, deletions: 0 }],
      linkedIssues: [{ labels: [{ name: "large-change-approved" }], state: "closed" }],
    });
    assert.equal(failures[0].code, "first_pr_too_large");
  });

  it("requires sponsorship for restricted surfaces", () => {
    const failures = assessTrustLane({
      authorAssociation: "NONE",
      files: [{ filename: ".github/workflows/ci.yml", additions: 10, deletions: 2 }],
    });
    assert.equal(failures[0].code, "restricted_surface");
  });

  it("allows sponsored restricted work", () => {
    const failures = assessTrustLane({
      authorAssociation: "NONE",
      files: [{ filename: "src/oauth/provider.ts", additions: 10, deletions: 2 }],
      linkedIssues: [{ labels: ["maintainer-sponsored"], state: "open" }],
    });
    assert.deepEqual(failures, []);
  });

  it("classifies renamed sources as restricted implementation paths", () => {
    const failures = assessTrustLane({
      authorAssociation: "NONE",
      files: [{ filename: "docs/moved.md", additions: 10, deletions: 2 }],
      changedFiles: ["docs/moved.md", "src/auth/oauth.ts"],
    });
    assert.equal(failures[0].code, "restricted_surface");
  });

  it("does not restrict established contributors, maintainers, or docs-only PRs", () => {
    assert.deepEqual(assessTrustLane({ authorAssociation: "CONTRIBUTOR", files: smallRuntimeChange }), []);
    assert.deepEqual(assessTrustLane({ authorAssociation: "NONE", authorHasPushPermission: true, files: smallRuntimeChange }), []);
    assert.deepEqual(assessTrustLane({ authorAssociation: "NONE", files: [{ filename: "README.md", additions: 900 }] }), []);
  });
});
