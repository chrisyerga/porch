export type OutputMode = "human" | "json";

export type CommandResult<T = unknown> = {
  ok: boolean;
  command: string;
  dryRun?: boolean;
  summary: string;
  data?: T;
  planned?: string[];
  applied?: string[];
  warnings?: string[];
};

export function printResult(result: CommandResult, mode: OutputMode): void {
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${result.ok ? "OK" : "ERROR"}: ${result.summary}\n`);
  if (result.dryRun) process.stdout.write("Dry run: no changes were applied.\n");
  printList("Planned", result.planned);
  printList("Applied", result.applied);
  printList("Warnings", result.warnings);
}

function printList(label: string, items: string[] | undefined): void {
  if (!items?.length) return;
  process.stdout.write(`\n${label}:\n`);
  for (const item of items) process.stdout.write(`- ${item}\n`);
}

export function outputMode(options: { json?: boolean }): OutputMode {
  return options.json ? "json" : "human";
}
