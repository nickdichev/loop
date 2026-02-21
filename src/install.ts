import { access, copyFile, mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const BIN_DIR = join(homedir(), ".local", "bin");
const IS_WINDOWS = process.platform === "win32";
const CANDIDATE_BINARIES = IS_WINDOWS
  ? ["loop.exe", "loop"]
  : ["loop", "loop.exe"];

const findBuiltBinary = async (): Promise<string> => {
  for (const name of CANDIDATE_BINARIES) {
    const candidate = resolve(process.cwd(), name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Built binary not found. Run `bun run build` first.");
};

const installBinary = async (): Promise<void> => {
  const source = await findBuiltBinary();
  const target = join(BIN_DIR, IS_WINDOWS ? "loop.exe" : "loop");

  await mkdir(BIN_DIR, { recursive: true });
  await rm(target, { force: true });

  if (IS_WINDOWS) {
    await copyFile(source, target);
    console.log(`Installed loop -> ${target}`);
    return;
  }

  try {
    await symlink(source, target);
  } catch {
    await copyFile(source, target);
  }

  console.log(`Installed loop -> ${target}`);
};

installBinary().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[loop] install failed: ${message}`);
  process.exit(1);
});
