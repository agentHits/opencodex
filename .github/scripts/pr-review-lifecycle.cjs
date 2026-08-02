"use strict";

const MAX_SUBSTANTIAL_REVIEW_ROUNDS = 2;
const CLOSURE_LABELS = [
  "close: no-approved-issue",
  "close: not-review-ready",
  "close: abandoned",
  "close: excessive-review-churn",
  "close: scope-too-large",
  "close: wrong-direction",
  "close: insufficient-tests",
];

function normalizeState(state) {
  return {
    version: 1,
    rounds: Number.isInteger(state?.rounds) && state.rounds >= 0 ? state.rounds : 0,
    lastCountedHeadSha:
      typeof state?.lastCountedHeadSha === "string" ? state.lastCountedHeadSha : null,
  };
}

function isSubstantialReview(body) {
  if (typeof body !== "string") return false;
  const text = body.replace(/<!--[^]*?-->/g, "").trim();
  return text.length >= 40;
}

function applyReviewEvent({
  state,
  reviewState,
  reviewBody,
  reviewerHasPushPermission,
  headSha,
}) {
  const current = normalizeState(state);
  const result = {
    ...current,
    counted: false,
    limitReached: current.rounds >= MAX_SUBSTANTIAL_REVIEW_ROUNDS,
  };

  if (String(reviewState || "").toLowerCase() !== "changes_requested") return result;
  if (!reviewerHasPushPermission || !isSubstantialReview(reviewBody)) return result;
  if (!headSha || headSha === current.lastCountedHeadSha) return result;

  const rounds = current.rounds + 1;
  return {
    version: 1,
    rounds,
    lastCountedHeadSha: headSha,
    counted: true,
    limitReached: rounds >= MAX_SUBSTANTIAL_REVIEW_ROUNDS,
  };
}

module.exports = {
  CLOSURE_LABELS,
  MAX_SUBSTANTIAL_REVIEW_ROUNDS,
  applyReviewEvent,
  isSubstantialReview,
  normalizeState,
};
