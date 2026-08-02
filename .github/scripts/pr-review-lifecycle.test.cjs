"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  CLOSURE_LABELS,
  MAX_SUBSTANTIAL_REVIEW_ROUNDS,
  applyReviewEvent,
  isSubstantialReview,
} = require("./pr-review-lifecycle.cjs");

const body = "The implementation still violates the routing boundary and needs a focused regression test.";

describe("review round accounting", () => {
  it("counts a substantial maintainer change request", () => {
    const result = applyReviewEvent({
      reviewState: "changes_requested",
      reviewBody: body,
      reviewerHasPushPermission: true,
      headSha: "aaa",
    });
    assert.equal(result.rounds, 1);
    assert.equal(result.counted, true);
    assert.equal(result.limitReached, false);
  });

  it("counts at most once per reviewed head SHA", () => {
    const result = applyReviewEvent({
      state: { rounds: 1, lastCountedHeadSha: "aaa" },
      reviewState: "changes_requested",
      reviewBody: body,
      reviewerHasPushPermission: true,
      headSha: "aaa",
    });
    assert.equal(result.rounds, 1);
    assert.equal(result.counted, false);
  });

  it("does not count non-maintainer or thin reviews", () => {
    assert.equal(applyReviewEvent({
      reviewState: "changes_requested",
      reviewBody: body,
      reviewerHasPushPermission: false,
      headSha: "aaa",
    }).rounds, 0);
    assert.equal(applyReviewEvent({
      reviewState: "changes_requested",
      reviewBody: "fix this",
      reviewerHasPushPermission: true,
      headSha: "aaa",
    }).rounds, 0);
  });

  it("flags the limit after two distinct reviewed revisions", () => {
    const result = applyReviewEvent({
      state: { rounds: 1, lastCountedHeadSha: "aaa" },
      reviewState: "changes_requested",
      reviewBody: body,
      reviewerHasPushPermission: true,
      headSha: "bbb",
    });
    assert.equal(MAX_SUBSTANTIAL_REVIEW_ROUNDS, 2);
    assert.equal(result.rounds, 2);
    assert.equal(result.limitReached, true);
  });

  it("ignores approvals and comments", () => {
    for (const reviewState of ["approved", "commented", "dismissed"]) {
      assert.equal(applyReviewEvent({
        reviewState,
        reviewBody: body,
        reviewerHasPushPermission: true,
        headSha: "aaa",
      }).rounds, 0);
    }
  });
});

describe("policy constants", () => {
  it("recognizes substantive review text", () => {
    assert.equal(isSubstantialReview(body), true);
    assert.equal(isSubstantialReview("too short"), false);
  });

  it("exports the complete closure taxonomy", () => {
    assert.deepEqual(CLOSURE_LABELS, [
      "close: no-approved-issue",
      "close: not-review-ready",
      "close: abandoned",
      "close: excessive-review-churn",
      "close: scope-too-large",
      "close: wrong-direction",
      "close: insufficient-tests",
    ]);
  });
});
