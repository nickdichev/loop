import { expect, mock, test } from "bun:test";
import { REVIEW_FAIL, REVIEW_PASS } from "../../src/loop/constants";
import { createRunReview } from "../../src/loop/review";
import type { Agent, Options, RunResult } from "../../src/loop/types";

const makeOptions = (): Options => ({
  agent: "codex",
  doneSignal: "<done/>",
  proof: "verify with tests",
  format: "raw",
  maxIterations: 5,
  model: "test-model",
});

const makeRunReview = (
  impl: (reviewer: Agent, prompt: string, opts: Options) => Promise<RunResult>
) => {
  const runAgentMock = mock(impl);
  const runReview = createRunReview(runAgentMock);
  return { runAgentMock, runReview };
};

test("runReview approves when all reviewers pass", async () => {
  const { runAgentMock, runReview } = makeRunReview(async () => ({
    combined: "",
    exitCode: 0,
    parsed: `Looks good.\n${REVIEW_PASS}`,
  }));

  const result = await runReview(
    ["codex", "claude"],
    "ship task",
    makeOptions()
  );

  expect(result).toEqual({ approved: true, consensusFail: false, notes: "" });
  expect(runAgentMock).toHaveBeenCalledTimes(2);
});

test("runReview treats mixed PASS and FAIL as failure", async () => {
  const { runReview } = makeRunReview(async () => ({
    combined: "",
    exitCode: 0,
    parsed: `${REVIEW_PASS}\n${REVIEW_FAIL}\nNeeds one more fix.`,
  }));

  const result = await runReview(["codex"], "ship task", makeOptions());

  expect(result.approved).toBe(false);
  expect(result.consensusFail).toBe(false);
  expect(result.notes).toContain("[codex]");
  expect(result.notes).toContain("Needs one more fix.");
});

test("runReview marks consensus failure when every reviewer fails", async () => {
  const { runReview } = makeRunReview((reviewer) => {
    if (reviewer === "codex") {
      return {
        combined: "",
        exitCode: 0,
        parsed: `${REVIEW_FAIL}\nFix naming.`,
      };
    }

    return {
      combined: "",
      exitCode: 0,
      parsed: `${REVIEW_FAIL}\nFix tests.`,
    };
  });

  const result = await runReview(
    ["codex", "claude"],
    "ship task",
    makeOptions()
  );

  expect(result.approved).toBe(false);
  expect(result.consensusFail).toBe(true);
  expect(result.notes).toContain("[codex]");
  expect(result.notes).toContain("[claude]");
});

test("runReview is not consensus failure when only one reviewer fails", async () => {
  const { runReview } = makeRunReview((reviewer) => {
    if (reviewer === "codex") {
      return {
        combined: "",
        exitCode: 0,
        parsed: REVIEW_PASS,
      };
    }

    return {
      combined: "please update docs",
      exitCode: 0,
      parsed: REVIEW_FAIL,
    };
  });

  const result = await runReview(
    ["codex", "claude"],
    "ship task",
    makeOptions()
  );

  expect(result.approved).toBe(false);
  expect(result.consensusFail).toBe(false);
  expect(result.notes).toContain("[claude]");
  expect(result.notes).not.toContain("[codex]");
});

test("runReview falls back to default note when reviewer output is empty", async () => {
  const { runReview } = makeRunReview(async () => ({
    combined: "",
    exitCode: 0,
    parsed: "",
  }));

  const result = await runReview(["codex"], "ship task", makeOptions());

  expect(result.notes).toContain("Reviewer requested more work.");
});

test("runReview keeps parallel results when one reviewer exits non-zero", async () => {
  const { runReview } = makeRunReview((reviewer) => {
    if (reviewer === "codex") {
      return {
        combined: "",
        exitCode: 0,
        parsed: REVIEW_PASS,
      };
    }

    return {
      combined: "error",
      exitCode: 2,
      parsed: "",
    };
  });

  const result = await runReview(
    ["codex", "claude"],
    "ship task",
    makeOptions()
  );

  expect(result.approved).toBe(false);
  expect(result.consensusFail).toBe(false);
  expect(result.notes).toContain("[claude]");
  expect(result.notes).toContain("exited with code 2");
  expect(result.notes).not.toContain("[codex]");
});

test("runReview handles non-zero exit for a single reviewer as failure", async () => {
  const { runReview } = makeRunReview(async () => ({
    combined: "error",
    exitCode: 2,
    parsed: "",
  }));

  const result = await runReview(["codex"], "ship task", makeOptions());
  expect(result.approved).toBe(false);
  expect(result.consensusFail).toBe(false);
  expect(result.notes).toContain("[codex]");
  expect(result.notes).toContain("exited with code 2");
});
