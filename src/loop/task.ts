import { buildPlanPrompt } from "./prompts";
import { runAgent } from "./runner";
import type { Options } from "./types";
import { isFile, readPrompt } from "./utils";

const PLAN_FILE = "PLAN.md";
const MISSING_PROMPT_ERROR =
  "Missing prompt. Use --prompt, pass positional text, or create PLAN.md.";
const MARKDOWN_PATH_RE = /^[^\s]+\.md$/i;

const isMarkdownInput = (input: string): boolean =>
  MARKDOWN_PATH_RE.test(input.trim());

const runPlanMode = async (opts: Options, task: string): Promise<void> => {
  console.log("\n[loop] prompt text detected. creating PLAN.md first.");
  const planPrompt = buildPlanPrompt(task);
  const result = await runAgent(opts.agent, planPrompt, opts);

  if (result.exitCode !== 0) {
    throw new Error(
      `[loop] planning ${opts.agent} exited with code ${result.exitCode}`
    );
  }

  if (!isFile(PLAN_FILE)) {
    throw new Error("[loop] planning step did not create PLAN.md");
  }
};

export const resolveTask = async (opts: Options): Promise<string> => {
  const source =
    opts.promptInput ?? (isFile(PLAN_FILE) ? PLAN_FILE : undefined);
  if (!source) {
    throw new Error(MISSING_PROMPT_ERROR);
  }

  if (!opts.promptInput || isMarkdownInput(opts.promptInput)) {
    return await readPrompt(source);
  }

  const task = opts.promptInput;
  await runPlanMode(opts, task);
  return await readPrompt(PLAN_FILE);
};
