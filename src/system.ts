import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunResult = {
  command: string;
  stdout: string;
  stderr: string;
};

export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; dryRun?: boolean } = {},
): Promise<RunResult> {
  const pretty = [command, ...args].join(" ");
  if (options.dryRun) return { command: pretty, stdout: "", stderr: "" };
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 10,
  });
  return { command: pretty, stdout: result.stdout, stderr: result.stderr };
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await run("sh", ["-c", `command -v ${quoteShell(command)}`]);
    return true;
  } catch {
    return false;
  }
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
