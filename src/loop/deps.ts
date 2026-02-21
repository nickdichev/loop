import { parseArgs } from "./args";
import { runLoop } from "./main";
import { runPanel } from "./panel";
import { resolveTask } from "./task";
import { runInTmux } from "./tmux";
import { maybeEnterWorktree } from "./worktree";

export const cliDeps = {
  maybeEnterWorktree,
  parseArgs,
  resolveTask,
  runInTmux,
  runLoop,
  runPanel,
};
