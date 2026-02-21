import { existsSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve as resolvePath,
} from "node:path";
import { spawnSync } from "bun";
import { buildLoopName, decode, runGit, sanitizeBase } from "./git";

export const TMUX_FLAG = "--tmux";
export const TMUX_MISSING_ERROR =
  "Error: tmux is not installed. Install tmux with: brew install tmux";
const WORKTREE_FLAG = "--worktree";
const RUN_BASE_ENV = "LOOP_RUN_BASE";
const RUN_ID_ENV = "LOOP_RUN_ID";

interface SpawnResult {
  exitCode: number;
  stderr: string;
}

interface TmuxDeps {
  attach: (session: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  findBinary: (cmd: string) => boolean;
  isInteractive: () => boolean;
  launchArgv: string[];
  log: (line: string) => void;
  spawn: (args: string[]) => SpawnResult;
}

const quoteShellArg = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

const buildShellCommand = (argv: string[]): string =>
  argv.map(quoteShellArg).join(" ");

const stripTmuxFlag = (argv: string[]): string[] =>
  argv.filter((arg) => arg !== TMUX_FLAG);

const MAX_SESSION_ATTEMPTS = 10_000;
const SESSION_CONFLICT_RE = /duplicate session|already exists/i;
const resolveRunBase = (cwd: string): string => {
  try {
    const repoRoot = runGit(cwd, ["rev-parse", "--show-toplevel"], "ignore");
    if (repoRoot.exitCode === 0 && repoRoot.stdout) {
      return sanitizeBase(basename(repoRoot.stdout));
    }
  } catch {
    return sanitizeBase(basename(cwd));
  }
  return sanitizeBase(basename(cwd));
};

const buildRunName = (base: string, index: number): string =>
  buildLoopName(base, index);

const worktreeAvailable = (cwd: string, runName: string): boolean => {
  const repoRoot = (() => {
    try {
      return runGit(cwd, ["rev-parse", "--show-toplevel"], "ignore");
    } catch {
      return undefined;
    }
  })();

  if (!repoRoot) {
    return true;
  }

  if (repoRoot.exitCode !== 0 || !repoRoot.stdout) {
    return true;
  }

  const path = join(dirname(repoRoot.stdout), runName);
  if (existsSync(path)) {
    return false;
  }

  const branch = (() => {
    try {
      return runGit(
        cwd,
        ["show-ref", "--verify", "--quiet", `refs/heads/${runName}`],
        "ignore"
      );
    } catch {
      return undefined;
    }
  })();
  if (!branch) {
    return true;
  }

  if (branch.exitCode === 0) {
    return false;
  }

  return true;
};

const commandExists = (cmd: string): boolean => {
  try {
    spawnSync([cmd, "-V"], { stderr: "ignore", stdout: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const isSessionConflict = (stderr: string): boolean =>
  SESSION_CONFLICT_RE.test(stderr);

const buildLaunchArgv = (
  processArgv: string[] = process.argv,
  execPath: string = process.execPath
): string[] => {
  const scriptArg = processArgv[1];
  if (
    !scriptArg ||
    scriptArg.startsWith("-") ||
    scriptArg.startsWith("/$bunfs/")
  ) {
    return [execPath];
  }
  const scriptPath = isAbsolute(scriptArg) ? scriptArg : resolvePath(scriptArg);
  return [execPath, scriptPath];
};

const defaultDeps = (): TmuxDeps => ({
  attach: (session: string) => {
    const result = spawnSync(["tmux", "attach", "-t", session], {
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to attach to tmux session "${session}".`);
    }
  },
  cwd: process.cwd(),
  env: process.env,
  findBinary: (cmd: string) => commandExists(cmd),
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  launchArgv: buildLaunchArgv(),
  log: (line: string) => {
    console.log(line);
  },
  spawn: (args: string[]) => {
    const result = spawnSync(args, { stderr: "pipe" });
    return { exitCode: result.exitCode, stderr: decode(result.stderr) };
  },
});

export const runInTmux = (
  argv: string[],
  overrides: Partial<TmuxDeps> = {}
): boolean => {
  if (!argv.includes(TMUX_FLAG)) {
    return false;
  }

  const deps = { ...defaultDeps(), ...overrides };
  if (deps.env.TMUX) {
    return false;
  }

  if (!deps.findBinary("tmux")) {
    throw new Error(TMUX_MISSING_ERROR);
  }

  const forwardedArgv = stripTmuxFlag(argv);
  const runBase = resolveRunBase(deps.cwd);
  const needsWorktree = argv.includes(WORKTREE_FLAG);
  let session = "";
  for (let index = 1; index <= MAX_SESSION_ATTEMPTS; index++) {
    const candidate = buildRunName(runBase, index);
    if (needsWorktree && !worktreeAvailable(deps.cwd, candidate)) {
      continue;
    }

    const command = buildShellCommand([
      "env",
      `${RUN_BASE_ENV}=${runBase}`,
      `${RUN_ID_ENV}=${index}`,
      ...deps.launchArgv,
      ...forwardedArgv,
    ]);
    const result = deps.spawn([
      "tmux",
      "new-session",
      "-d",
      "-s",
      candidate,
      "-c",
      deps.cwd,
      command,
    ]);
    if (result.exitCode === 0) {
      session = candidate;
      break;
    }
    if (isSessionConflict(result.stderr)) {
      continue;
    }

    const suffix = result.stderr ? `: ${result.stderr}` : ".";
    throw new Error(`Failed to start tmux session${suffix}`);
  }

  if (!session) {
    throw new Error(
      "Failed to start tmux session: no free session name found."
    );
  }

  deps.log(`[loop] started tmux session "${session}"`);
  deps.log(`[loop] attach with: tmux attach -t ${session}`);
  if (deps.isInteractive()) {
    deps.attach(session);
  }
  return true;
};

export const tmuxInternals = {
  buildLaunchArgv,
  buildRunName,
  buildShellCommand,
  isSessionConflict,
  quoteShellArg,
  sanitizeBase,
  stripTmuxFlag,
  worktreeAvailable,
};
