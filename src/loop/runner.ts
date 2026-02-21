import { spawn } from "bun";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL } from "./constants";
import type { Agent, Options, RunResult } from "./types";

type ExitSignal = "SIGINT" | "SIGTERM";

const SIGNAL_EXIT_CODES: Record<ExitSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
};

const activeChildren = new Set<ReturnType<typeof spawn>>();
let watchingSignals = false;

const killChildren = (signal: ExitSignal): void => {
  for (const child of activeChildren) {
    child.kill(signal);
  }
};

const onSigint = (): void => {
  killChildren("SIGINT");
  process.exit(SIGNAL_EXIT_CODES.SIGINT);
};

const onSigterm = (): void => {
  killChildren("SIGTERM");
  process.exit(SIGNAL_EXIT_CODES.SIGTERM);
};

const syncSignalHandlers = (): void => {
  if (activeChildren.size > 0 && !watchingSignals) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    watchingSignals = true;
    return;
  }

  if (activeChildren.size === 0 && watchingSignals) {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    watchingSignals = false;
  }
};

const buildCommand = (
  agent: Agent,
  prompt: string,
  model: string
): { args: string[]; cmd: string } => {
  if (agent === "claude") {
    const claudeModel =
      model && model !== DEFAULT_CODEX_MODEL ? model : DEFAULT_CLAUDE_MODEL;
    return {
      args: [
        "-p",
        prompt,
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        claudeModel,
      ],
      cmd: "claude",
    };
  }

  return {
    args: [
      "exec",
      "--json",
      "--model",
      model,
      "-c",
      'model_reasoning_effort="xhigh"',
      "--yolo",
      prompt,
    ],
    cmd: "codex",
  };
};

const eventMessage = (line: string): string => {
  if (!line.trim().startsWith("{")) {
    return "";
  }

  try {
    const event = JSON.parse(line) as {
      item?: {
        content?: Array<{ text?: string }>;
        text?: string;
        type?: string;
      };
      message?: { content?: Array<{ text?: string; type?: string }> };
      result?: unknown;
      type?: string;
    };

    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message"
    ) {
      return (
        event.item.text?.trim() ||
        (event.item.content ?? [])
          .map((part) => part.text ?? "")
          .join("")
          .trim()
      );
    }

    if (event.type === "assistant") {
      return (event.message?.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    }

    if (event.type === "result" && typeof event.result === "string") {
      return event.result.trim();
    }

    return "";
  } catch {
    return "";
  }
};

const consume = async (
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        onText(decoder.decode(value, { stream: true }));
      }
    }

    const tail = decoder.decode();
    if (tail) {
      onText(tail);
    }
  } finally {
    reader.releaseLock();
  }
};

export const runAgent = async (
  agent: Agent,
  prompt: string,
  opts: Options
): Promise<RunResult> => {
  const { args, cmd } = buildCommand(agent, prompt, opts.model);
  const proc = spawn([cmd, ...args], {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  activeChildren.add(proc);
  syncSignalHandlers();

  let stdout = "";
  let stderr = "";
  let parsed = "";
  let pending = "";
  let lastMessage = "";
  let prettyCount = 0;

  const writePretty = (text: string): void => {
    if (opts.format !== "pretty") {
      return;
    }
    if (!text.trim()) {
      return;
    }
    if (prettyCount > 0) {
      process.stdout.write("\n");
    }
    process.stdout.write(`${text}\n`);
    prettyCount++;
  };

  const onLine = (line: string): void => {
    const message = eventMessage(line);
    if (message) {
      if (message === lastMessage) {
        return;
      }

      lastMessage = message;
      parsed += `${parsed ? "\n" : ""}${message}`;
      writePretty(message);
      return;
    }

    if (!line.trim().startsWith("{")) {
      writePretty(line);
    }
  };

  try {
    const outTask = consume(proc.stdout, (text) => {
      stdout += text;
      pending += text;

      let index = pending.indexOf("\n");
      while (index !== -1) {
        onLine(pending.slice(0, index));
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
      }

      if (opts.format === "raw") {
        process.stdout.write(text);
      }
    });

    const errTask = consume(proc.stderr, (text) => {
      stderr += text;
      process.stderr.write(text);
    });

    await Promise.all([outTask, errTask]);
    if (pending.trim()) {
      onLine(pending);
    }

    const exitCode = await proc.exited;
    return { combined: `${stdout}\n${stderr}`, exitCode, parsed };
  } finally {
    activeChildren.delete(proc);
    syncSignalHandlers();
  }
};
