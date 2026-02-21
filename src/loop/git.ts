import { spawnSync } from "bun";

export interface GitResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const SAFE_NAME_RE = /[^a-z0-9-]+/g;

export const decode = (value: Uint8Array | null | undefined): string =>
  value ? new TextDecoder().decode(value).trim() : "";

export const sanitizeBase = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(SAFE_NAME_RE, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "loop";
};

export const buildLoopName = (base: string, index: number): string =>
  `${base}-loop-${index}`;

export const runGit = (
  cwd: string,
  args: string[],
  stderr: "pipe" | "ignore" = "pipe"
): GitResult => {
  const result = spawnSync(["git", ...args], {
    cwd,
    stderr,
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: stderr === "ignore" ? "" : decode(result.stderr),
    stdout: decode(result.stdout),
  };
};
