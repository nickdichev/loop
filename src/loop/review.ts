import { REVIEW_FAIL, REVIEW_PASS } from "./constants";
import { buildReviewPrompt } from "./prompts";
import { runAgent } from "./runner";
import type {
  Agent,
  Options,
  ReviewMode,
  ReviewResult,
  RunResult,
} from "./types";
import { hasSignal } from "./utils";

export const resolveReviewers = (
  review: ReviewMode | undefined,
  agent: Agent
): Agent[] => {
  if (!review) {
    return [];
  }

  if (review === "claudex") {
    return agent === "codex" ? ["codex", "claude"] : ["claude", "codex"];
  }

  return [review];
};

type RunAgentFn = (
  agent: Agent,
  prompt: string,
  opts: Options
) => Promise<RunResult>;

const runReviewWith = async (
  run: RunAgentFn,
  reviewers: Agent[],
  task: string,
  opts: Options
): Promise<ReviewResult> => {
  const prompt = buildReviewPrompt(task, opts.doneSignal, opts.proof);

  const runOne = async (reviewer: Agent) => {
    console.log(`\n[loop] review with ${reviewer}`);
    return { result: await run(reviewer, prompt, opts), reviewer };
  };

  const notes: string[] = [];
  let failures = 0;

  const addFailure = (reviewer: Agent, note: string): void => {
    failures++;
    notes.push(
      `[${reviewer}] ${note.trim() || "Reviewer requested more work."}`
    );
  };

  const evaluateResult = ({
    result,
    reviewer,
  }: Awaited<ReturnType<typeof runOne>>): void => {
    if (result.exitCode !== 0) {
      addFailure(
        reviewer,
        `[loop] review ${reviewer} exited with code ${result.exitCode}`
      );
      return;
    }

    const text = `${result.parsed}\n${result.combined}`;
    if (hasSignal(text, REVIEW_PASS) && !hasSignal(text, REVIEW_FAIL)) {
      return;
    }

    addFailure(
      reviewer,
      (result.parsed || result.combined).trim() ||
        "Reviewer requested more work."
    );
  };

  const settled = await Promise.allSettled(reviewers.map(runOne));
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      evaluateResult(outcome.value);
      continue;
    }

    const reason =
      outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
    addFailure(reviewers[index], reason || "Reviewer run failed.");
  }

  return {
    approved: failures === 0,
    consensusFail: reviewers.length > 1 && failures === reviewers.length,
    notes: notes.join("\n\n"),
  };
};

export const createRunReview = (run: RunAgentFn) => {
  return (reviewers: Agent[], task: string, opts: Options) =>
    runReviewWith(run, reviewers, task, opts);
};

export const runReview = async (
  reviewers: Agent[],
  task: string,
  opts: Options
): Promise<ReviewResult> => runReviewWith(runAgent, reviewers, task, opts);
