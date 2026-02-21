import { expect, test } from "bun:test";
import { resolveReviewers } from "../../src/loop/review";

test("resolveReviewers returns empty list when review is not enabled", () => {
  expect(resolveReviewers(undefined, "codex")).toEqual([]);
});

test("resolveReviewers returns claudex reviewers in deterministic order", () => {
  expect(resolveReviewers("claudex", "codex")).toEqual(["codex", "claude"]);
  expect(resolveReviewers("claudex", "claude")).toEqual(["claude", "codex"]);
});

test("resolveReviewers returns the explicit reviewer", () => {
  expect(resolveReviewers("claude", "codex")).toEqual(["claude"]);
  expect(resolveReviewers("codex", "claude")).toEqual(["codex"]);
});
