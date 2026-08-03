"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_ATTESTATIONS,
  assessAdmission,
  extractLinkedIssueNumbers,
  missingAttestations,
  needsApprovedIssue,
} = require("./pr-admission.cjs");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function completeBody() {
  return [
    "## Summary",
    "A complete explanation of the change and why it is needed.",
    "",
    "## Linked issue",
    "Closes #123",
    "",
    "## Author responsibility",
    ...REQUIRED_ATTESTATIONS.map((label) => `- [x] ${label}`),
    "",
  ].join("\n");
}

describe("missingAttestations", () => {
  it("rejects unchecked and missing author responsibility items", () => {
    const body = [
      `- [x] ${REQUIRED_ATTESTATIONS[0]}`,
      `- [ ] ${REQUIRED_ATTESTATIONS[1]}`,
    ].join("\n");

    assert.deepEqual(
      missingAttestations(body),
      REQUIRED_ATTESTATIONS.slice(1),
    );
  });

  it("accepts every required checked item", () => {
    assert.deepEqual(missingAttestations(completeBody()), []);
  });
});

describe("extractLinkedIssueNumbers", () => {
  it("recognizes closing and reference syntax without duplicates", () => {
    assert.deepEqual(
      extractLinkedIssueNumbers("Closes #12\nRefs: #34\nFixes #12"),
      [12, 34],
    );
  });
});

describe("needsApprovedIssue", () => {
  it("requires an approved issue for implementation paths", () => {
    assert.equal(needsApprovedIssue(["src/router.ts"]), true);
    assert.equal(needsApprovedIssue(["gui/src/App.tsx"]), true);
    assert.equal(needsApprovedIssue(["package.json"]), true);
    assert.equal(needsApprovedIssue(["bunfig.toml"]), true);
  });

  it("does not require one for documentation-only changes", () => {
    assert.equal(
      needsApprovedIssue(["README.md", "docs-site/src/content/docs/foo.md"]),
      false,
    );
  });
});

describe("assessAdmission", () => {
  it("rejects implementation PRs with no linked issue", () => {
    const failures = assessAdmission({
      body: completeBody(),
      changedFiles: ["src/router.ts"],
      linkedIssues: [],
    });

    assert.deepEqual(failures, [{ code: "missing_issue" }]);
  });

  it("rejects linked issues that are not approved for work", () => {
    const failures = assessAdmission({
      body: completeBody(),
      changedFiles: ["src/router.ts"],
      linkedIssues: [{ number: 123, labels: ["bug"], state: "open" }],
    });

    assert.deepEqual(failures, [
      { code: "issue_not_approved", issues: [123] },
    ]);
  });

  it("accepts an approved implementation issue", () => {
    const failures = assessAdmission({
      body: completeBody(),
      changedFiles: ["src/router.ts"],
      linkedIssues: [
        { number: 123, labels: [{ name: "approved-for-work" }], state: "open" },
      ],
    });

    assert.deepEqual(failures, []);
  });

  it("rejects closed issues even when they carry the approval label", () => {
    const failures = assessAdmission({
      body: completeBody(),
      changedFiles: ["src/router.ts"],
      linkedIssues: [
        { number: 123, labels: [{ name: "approved-for-work" }], state: "closed" },
      ],
    });

    assert.deepEqual(failures, [
      { code: "issue_not_approved", issues: [123] },
    ]);
  });

  it("allows maintainers to perform integration work without an issue", () => {
    const failures = assessAdmission({
      body: completeBody(),
      changedFiles: ["src/router.ts"],
      linkedIssues: [],
      authorHasPushPermission: true,
    });

    assert.deepEqual(failures, []);
  });

  it("still requires maintainer attestations", () => {
    const failures = assessAdmission({
      body: "",
      changedFiles: ["src/router.ts"],
      linkedIssues: [],
      authorHasPushPermission: true,
    });

    assert.equal(failures[0].code, "missing_attestations");
  });
});

describe("template parity", () => {
  it("keeps the PR template attestations in sync with REQUIRED_ATTESTATIONS", () => {
    const template = fs.readFileSync(
      path.join(__dirname, "..", "PULL_REQUEST_TEMPLATE.md"),
      "utf8",
    );
    for (const label of REQUIRED_ATTESTATIONS) {
      const pattern = new RegExp(
        `^\\s*[-*+]\\s+\\[[ xX]\\]\\s+${escapeRegExp(label)}\\s*$`,
        "m",
      );
      assert.match(template, pattern);
    }
  });
});
