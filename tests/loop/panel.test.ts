import { expect, test } from "bun:test";
import { panelInternals } from "../../src/loop/panel";

test("parseProcessList keeps codex engine and deduplicates wrapper", () => {
  const output = `
  PID  PPID COMMAND
54665 4474 node /Users/me/.nvm/versions/node/v24.9.0/bin/codex
54666 54665 /Users/me/.nvm/versions/node/v24.9.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex
88398 87837 claude
`.trim();
  const rows = panelInternals.parseProcessList(output);
  expect(rows).toEqual([
    { agent: "codex", pid: 54_666 },
    { agent: "claude", pid: 88_398 },
  ]);
});

test("parseLsofSnapshot extracts cwd and file names", () => {
  const output = `
p54666
fcwd
n/Users/me/project
f16
n/Users/me/.codex/sessions/2026/02/20/rollout.jsonl
`.trim();
  const parsed = panelInternals.parseLsofSnapshot(output);
  expect(parsed.cwd).toBe("/Users/me/project");
  expect(parsed.names).toContain(
    "/Users/me/.codex/sessions/2026/02/20/rollout.jsonl"
  );
});

test("parseTmuxSessions keeps active loop sessions and extracts ids", () => {
  const output = `
repo-loop-2\t0
repo-loop-10\t1
scratch\t0
`.trim();
  const rows = panelInternals.parseTmuxSessions(output);
  expect(rows).toEqual([
    { attached: false, id: 2, session: "repo-loop-2" },
    { attached: true, id: 10, session: "repo-loop-10" },
  ]);
});

test("projectKeyFromCwd matches claude project folder naming", () => {
  expect(panelInternals.projectKeyFromCwd("/Users/me/code/loop")).toBe(
    "-Users-me-code-loop"
  );
});

test("parseTimestampMs returns NaN for invalid timestamp", () => {
  expect(Number.isNaN(panelInternals.parseTimestampMs("invalid"))).toBe(true);
});

test("reconcileDoneRows moves disappeared instance into done section", () => {
  const previous = [
    {
      agent: "codex" as const,
      cwd: "/Users/me/code/loop",
      event: "event_msg/task_complete",
      idle: "0s",
      pid: 54_666,
      session: "session-1",
      state: "active",
    },
  ];
  const next = panelInternals.reconcileDoneRows(previous, [], [], 1000);
  expect(next).toHaveLength(1);
  expect(next[0]).toMatchObject({
    id: "codex:session-1",
    row: previous[0],
  });
  expect(next[0]?.endedAtMs).toBe(1000);
});

test("reconcileDoneRows removes done entry when session is running again", () => {
  const running = [
    {
      agent: "claude" as const,
      cwd: "/Users/me/code/loop",
      event: "progress",
      idle: "0s",
      pid: 88_398,
      session: "session-2",
      state: "active",
    },
  ];
  const existingDone = [
    {
      endedAtMs: 500,
      id: "claude:session-2",
      row: running[0],
    },
  ];
  const next = panelInternals.reconcileDoneRows(
    [],
    running,
    existingDone,
    1000
  );
  expect(next).toHaveLength(0);
});

test("buildLines uses stacked layout on narrow terminals", () => {
  const snapshot = {
    rows: [
      {
        agent: "codex" as const,
        cwd: "/Users/me/some/really/long/path/to/project",
        event: "event_msg/task_complete",
        idle: "2m",
        pid: 54_666,
        session: "session-with-a-very-long-id",
        state: "idle",
      },
    ],
    tmuxRows: [{ attached: false, id: 3, session: "repo-loop-3" }],
  };
  const doneRows = [
    {
      endedAtMs: Date.now() - 30_000,
      id: "codex:done-session",
      row: {
        agent: "codex" as const,
        cwd: "/Users/me/another/really/long/path/to/project",
        event: "event_msg/task_complete",
        idle: "-",
        pid: -1,
        session: "done-session",
        state: "done",
      },
    },
  ];
  const lines = panelInternals.buildLines(snapshot, doneRows, 60);

  expect(lines).toContain("[running] 1");
  expect(lines).toContain("[done] 1");
  expect(lines).toContain("[tmux] 1");
  expect(
    lines.some((line) => line.startsWith("id=3 session=repo-loop-3"))
  ).toBe(true);
  expect(lines.some((line) => line.startsWith("session: "))).toBe(true);
  expect(lines.some((line) => line.startsWith("final: "))).toBe(true);
});
